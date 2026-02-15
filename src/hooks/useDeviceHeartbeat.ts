import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";

/**
 * 스마트폰 디바이스의 온라인/오프라인 상태를 관리하는 훅
 * - 포그라운드 진입 시 status = 'online'
 * - 백그라운드 전환/종료 시 status = 'offline'
 * - 30초 간격 heartbeat로 last_seen_at 갱신
 */
export function useDeviceHeartbeat() {
  const { user } = useAuth();
  const { devices } = useDevices();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 현재 유저의 스마트폰 디바이스 찾기
  const smartphoneDevice = devices.find(
    (d) => d.device_type === "smartphone" && d.user_id === user?.id
  );

  useEffect(() => {
    if (!smartphoneDevice) return;

    const deviceId = smartphoneDevice.id;

    const setOnline = async () => {
      try {
        await supabase
          .from("devices")
          .update({
            status: "online",
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", deviceId);
        console.log("[Heartbeat] ✅ Status set to online:", deviceId.slice(0, 8));
      } catch (err) {
        console.error("[Heartbeat] Failed to set online:", err);
      }
    };

    const setOffline = async () => {
      try {
        // 스마트폰 오프라인 설정
        await supabase
          .from("devices")
          .update({ status: "offline" })
          .eq("id", deviceId);
        // 모든 기기 감시 OFF (스마트폰 앱 종료 시 감시 해제)
        if (user?.id) {
          await supabase
            .from("devices")
            .update({ is_monitoring: false })
            .eq("user_id", user.id)
            .neq("device_type", "smartphone");
        }
        console.log("[Heartbeat] ⚫ Status set to offline + monitoring OFF:", deviceId.slice(0, 8));
      } catch (err) {
        console.error("[Heartbeat] Failed to set offline:", err);
      }
    };

    const sendHeartbeat = async () => {
      try {
        await supabase
          .from("devices")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", deviceId);
      } catch (err) {
        console.error("[Heartbeat] Heartbeat failed:", err);
      }
    };

    // 앱 시작 시 온라인 설정
    setOnline();

    // 30초 간격 heartbeat
    heartbeatRef.current = setInterval(sendHeartbeat, 30000);

    // visibilitychange 핸들러
    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        setOnline();
        // heartbeat 재시작
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(sendHeartbeat, 30000);
      } else {
        // 감시 중이면 백그라운드 전환 시 offline으로 바꾸지 않음
        // (다른 앱 사용 중에도 감시 유지)
        const { data } = await supabase
          .from("devices")
          .select("is_monitoring")
          .eq("user_id", user!.id)
          .neq("device_type", "smartphone")
          .eq("is_monitoring", true)
          .limit(1);
        
        const anyMonitoring = data && data.length > 0;
        
        if (anyMonitoring) {
          console.log("[Heartbeat] 🟡 Background but monitoring active — staying online");
          // heartbeat는 유지하여 last_seen_at 갱신 계속
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
          user_id: user?.id,
        });
        const blob = new Blob([payload], { type: 'application/json' });
        
        // sendBeacon은 POST를 보내므로 Edge Function으로 처리
        const sent = navigator.sendBeacon?.(
          `${supabaseUrl}/functions/v1/app-close`,
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
      setOffline();
    };
  }, [smartphoneDevice?.id]);
}
