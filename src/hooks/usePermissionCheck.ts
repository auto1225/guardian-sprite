/**
 * usePermissionCheck — 브라우저 권한 상태를 감지하고 관리하는 훅
 * 
 * 확인하는 권한:
 *   1. 알림(Notification) — 경보음, 푸시 알림
 *   2. 카메라(Camera) — 실시간 스트리밍
 *   3. 위치(Geolocation) — 위치 추적
 */
import { useState, useEffect, useCallback } from "react";

export interface PermissionItem {
  key: string;
  name: string;        // i18n key
  description: string; // i18n key
  status: "granted" | "denied" | "prompt" | "unavailable";
  request: () => Promise<"granted" | "denied">;
  affectedFeatures: string; // i18n key
}

const DISMISSED_KEY = "meercop_permissions_dismissed";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  } catch { return false; }
}

function setDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, "true"); } catch {}
}

function clearDismissed() {
  try { localStorage.removeItem(DISMISSED_KEY); } catch {}
}

export function usePermissionCheck() {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [shouldShow, setShouldShow] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkPermissions = useCallback(async () => {
    const items: PermissionItem[] = [];

    // 1. Notification
    if ("Notification" in window) {
      const status = Notification.permission === "default" ? "prompt" : Notification.permission as "granted" | "denied";
      items.push({
        key: "notification",
        name: "permissions.notification",
        description: "permissions.notificationDesc",
        status,
        request: async () => {
          const result = await Notification.requestPermission();
          return result === "granted" ? "granted" : "denied";
        },
        affectedFeatures: "permissions.notificationFeatures",
      });
    }

    // 2. Camera
    try {
      const camPerm = await navigator.permissions.query({ name: "camera" as PermissionName });
      items.push({
        key: "camera",
        name: "permissions.camera",
        description: "permissions.cameraDesc",
        status: camPerm.state as "granted" | "denied" | "prompt",
        request: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());
            return "granted";
          } catch { return "denied"; }
        },
        affectedFeatures: "permissions.cameraFeatures",
      });
    } catch {
      // permissions API not supported for camera
      items.push({
        key: "camera",
        name: "permissions.camera",
        description: "permissions.cameraDesc",
        status: "prompt",
        request: async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());
            return "granted";
          } catch { return "denied"; }
        },
        affectedFeatures: "permissions.cameraFeatures",
      });
    }

    // 3. Geolocation
    try {
      const geoPerm = await navigator.permissions.query({ name: "geolocation" });
      items.push({
        key: "geolocation",
        name: "permissions.location",
        description: "permissions.locationDesc",
        status: geoPerm.state as "granted" | "denied" | "prompt",
        request: async () => {
          return new Promise<"granted" | "denied">((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve("granted"),
              () => resolve("denied"),
              { timeout: 10000 }
            );
          });
        },
        affectedFeatures: "permissions.locationFeatures",
      });
    } catch {
      items.push({
        key: "geolocation",
        name: "permissions.location",
        description: "permissions.locationDesc",
        status: "prompt",
        request: async () => {
          return new Promise<"granted" | "denied">((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve("granted"),
              () => resolve("denied"),
              { timeout: 10000 }
            );
          });
        },
        affectedFeatures: "permissions.locationFeatures",
      });
    }

    setPermissions(items);

    // 미승인 항목이 있는지 확인
    const needsAttention = items.some(p => p.status !== "granted");
    
    if (needsAttention) {
      // 한 번이라도 승인/닫기 했으면 다시 표시하지 않음
      setShouldShow(!isDismissed());
    } else {
      // 모든 권한이 granted — 팝업 불필요
      setShouldShow(false);
    }

    setChecked(true);
  }, []);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const dismiss = useCallback(() => {
    setDismissed();
    setShouldShow(false);
  }, []);

  const refresh = useCallback(() => {
    checkPermissions();
  }, [checkPermissions]);

  return {
    permissions,
    shouldShow,
    checked,
    dismiss,
    refresh,
  };
}
