import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithRetry } from "@/lib/invokeWithRetry";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";

/**
 * 스마트폰 디바이스의 온라인/오프라인 상태를 관리하는 훅
 * - 포그라운드 진입 시 status = 'online'
 * - 백그라운드 전환/종료 시 status = 'offline'
 * - 30초 간격 heartbeat로 last_seen_at 갱신
 */
export function useDeviceHeartbeat() {
  const { effectiveUserId } = useAuth();
  const { devices } = useDevices();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 현재 유저의 스마트폰 디바이스 찾기
  const smartphoneDevice = devices.find(
    (d) => d.device_type === "smartphone" && d.user_id === effectiveUserId
  );

  useEffect(() => {
    if (!smartphoneDevice) return;

    const deviceId = smartphoneDevice.id;

    const getBatteryInfo = async (): Promise<{ level: number | null; charging: boolean | null }> => {
      try {
        if (navigator.getBattery) {
          const battery = await navigator.getBattery();
          return { level: Math.round(battery.level * 100), charging: battery.charging };
        }
      } catch (err) {
        console.warn("[Heartbeat] Battery API 접근 실패:", err);
      }
      return { level: null, charging: null };
    };

    const setOnline = async () => {
      try {
        const { level } = await getBatteryInfo();
        await invokeWithRetry("update-device", {
          body: {
            device_id: deviceId,
            status: "online",
            last_seen_at: new Date().toISOString(),
            ...(level !== null ? { battery_level: level } : {}),
          },
        });
        console.log("[Heartbeat] ✅ Status set to online:", deviceId.slice(0, 8), "battery:", level);
      } catch (err) {
        console.error("[Heartbeat] Failed to set online:", err);
      }
    };

    const setOffline = async () => {
      try {
        await invokeWithRetry("update-device", {
          body: { device_id: deviceId, status: "offline" },
        });
        // 모든 기기 감시 OFF (스마트폰 앱 종료 시 감시 해제)
        if (effectiveUserId) {
          // Edge Function을 통해 처리 (RLS 우회)
          const { data } = await supabase.functions.invoke("get-devices", {
            body: { user_id: effectiveUserId },
          });
          const otherDevices = (data?.devices || []).filter(
            (d: { device_type: string; id: string }) => d.device_type !== "smartphone"
          );
          for (const d of otherDevices) {
            await invokeWithRetry("update-device", {
              body: { device_id: d.id, is_monitoring: false },
            });
          }
        }
        console.log("[Heartbeat] ⚫ Status set to offline + monitoring OFF:", deviceId.slice(0, 8));
      } catch (err) {
        console.error("[Heartbeat] Failed to set offline:", err);
      }
    };

    const sendHeartbeat = async () => {
      try {
        const { level } = await getBatteryInfo();
        await invokeWithRetry("update-device", {
          body: {
            device_id: deviceId,
            last_seen_at: new Date().toISOString(),
            ...(level !== null ? { battery_level: level } : {}),
          },
        });
      } catch (err) {
        console.error("[Heartbeat] Heartbeat failed:", err);
      }
    };

    // 앱 시작 시 온라인 설정
    setOnline();

    // 30초 간격 heartbeat
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    // visibilitychange 핸들러
    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        setOnline();
        // heartbeat 재시작
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      } else {
        // 경보음이 재생 중이면 백그라운드 전환 시 offline으로 바꾸지 않음
        try {
          const AlarmMod = await import("@/lib/alarmSound");
          if (AlarmMod.isPlaying()) {
            console.log("[Heartbeat] 🟡 Background but alarm playing — staying online");
            return;
          }
        } catch {}

        // 감시 중이면 백그라운드 전환 시 offline으로 바꾸지 않음
        const { data } = await supabase.functions.invoke("get-devices", {
          body: { user_id: effectiveUserId },
        });
        const monitoringDevices = (data?.devices || []).filter(
          (d: { device_type: string; is_monitoring: boolean }) =>
            d.device_type !== "smartphone" && d.is_monitoring
        );
        
        if (monitoringDevices.length > 0) {
          console.log("[Heartbeat] 🟡 Background but monitoring active — staying online");
        } else {
          setOffline();
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
        }
      }
    };

    // beforeunload 핸들러 - Edge Function을 sendBeacon으로 호출 (POST 지원)
    const handleBeforeUnload = () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        
        const payload = JSON.stringify({
          device_id: deviceId,
          user_id: effectiveUserId,
        });
        const blob = new Blob([payload], { type: 'application/json' });
        
        // sendBeacon은 커스텀 헤더를 지원하지 않으므로 apikey를 쿼리 파라미터로 전달
        const sent = navigator.sendBeacon?.(
          `${supabaseUrl}/functions/v1/app-close?apikey=${supabaseKey}`,
          blob
        );
        console.log("[Heartbeat] sendBeacon to app-close:", sent);
      } catch (err) {
        console.error("[Heartbeat] sendBeacon failed:", err);
      }
      // Fallback: async setOffline (may not complete)
      setOffline();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // setOffline()을 cleanup에서 호출하지 않음 — 리렌더/HMR 시 레이스 컨디션 방지
      // 실제 종료는 beforeunload(sendBeacon)과 visibilitychange가 처리
    };
  }, [smartphoneDevice?.id, effectiveUserId]);
}
