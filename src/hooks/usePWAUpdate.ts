import { useEffect, useCallback } from "react";

/**
 * PWA 업데이트 감지 및 자동 새로고침 훅
 * - 새 Service Worker가 감지되면 즉시 활성화 후 페이지 새로고침
 * - 앱이 포그라운드로 돌아올 때마다 업데이트 체크
 */
export function usePWAUpdate() {
  const checkForUpdate = useCallback(() => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          reg.update().catch(() => {});
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // 1) 새 SW가 대기 중이면 즉시 활성화 요청
    const handleControllerChange = () => {
      console.log("[PWA Update] New version activated, reloading...");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // 2) SW 등록 후 waiting 상태 감지
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      // 이미 대기 중인 SW가 있으면 즉시 활성화
      if (reg.waiting) {
        console.log("[PWA Update] Waiting SW found, activating...");
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // 새 SW가 설치되면 즉시 활성화
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;

        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA Update] New SW installed, activating...");
            newSW.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    });

    // 3) 앱이 포그라운드로 돌아올 때 업데이트 체크
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // 4) 주기적 업데이트 체크 (10분마다)
    const interval = setInterval(checkForUpdate, 10 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [checkForUpdate]);
}
