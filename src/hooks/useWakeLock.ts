import { useEffect, useRef, useCallback } from "react";

/**
 * useWakeLock — 감시 모드 중 화면 꺼짐 방지
 * Screen Wake Lock API를 사용하여 OS가 앱을 절전/백그라운드 킬하는 것을 방지
 * 
 * - isMonitoring이 true일 때만 활성화
 * - visibilitychange에서 자동 재획득 (화면 잠금 해제 시)
 * - API 미지원 브라우저에서는 graceful 스킵
 */
export function useWakeLock(isMonitoring: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActiveRef = useRef(false);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) {
      console.log("[WakeLock] ⚠️ Wake Lock API not supported");
      return;
    }

    // 이미 활성화된 경우 스킵
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      isActiveRef.current = true;
      console.log("[WakeLock] 🔒 Wake Lock acquired");

      wakeLockRef.current.addEventListener("release", () => {
        console.log("[WakeLock] 🔓 Wake Lock released");
        isActiveRef.current = false;
      });
    } catch (err) {
      console.warn("[WakeLock] Failed to acquire:", err);
      isActiveRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
        console.log("[WakeLock] 🔓 Wake Lock manually released");
      } catch (err) {
        console.warn("[WakeLock] Release failed:", err);
      }
    }
    wakeLockRef.current = null;
    isActiveRef.current = false;
  }, []);

  useEffect(() => {
    if (!isMonitoring) {
      releaseWakeLock();
      return;
    }

    // 감시 모드 활성화 시 Wake Lock 요청
    requestWakeLock();

    // 화면 복귀 시 자동 재획득 (OS가 백그라운드에서 해제한 경우)
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isMonitoring) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseWakeLock();
    };
  }, [isMonitoring, requestWakeLock, releaseWakeLock]);

  return { isActive: isActiveRef.current };
}
