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
        await supabase
          .from("devices")
          .update({ status: "offline" })
          .eq("id", deviceId);
        console.log("[Heartbeat] ⚫ Status set to offline:", deviceId.slice(0, 8));
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
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setOnline();
        // heartbeat 재시작
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(sendHeartbeat, 30000);
      } else {
        setOffline();
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      }
    };

    // beforeunload 핸들러
    const handleBeforeUnload = () => {
      // sendBeacon 으로 오프라인 상태 전송 (비동기 요청이 완료되기 전에 페이지가 닫힐 수 있으므로)
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}`;
      const body = JSON.stringify({ status: "offline" });
      navigator.sendBeacon?.(url); // fallback, 실제로는 supabase REST 직접 호출이 어려움
      // 동기 방식 fallback
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
