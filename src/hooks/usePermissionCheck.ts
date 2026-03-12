/**
 * usePermissionCheck — 브라우저 권한 상태를 감지하고 관리하는 훅
 * 
 * 확인하는 권한:
 *   1. 알림(Notification) — 경보음, 푸시 알림
 *   2. 카메라(Camera) — 실시간 스트리밍
 *   3. 위치(Geolocation) — 위치 추적
 */
import { useState, useEffect, useCallback } from "react";
import { isRunningInNativeApp } from "@/lib/nativeBridge";

export interface PermissionItem {
  key: string;
  name: string;        // i18n key
  description: string; // i18n key
  status: "granted" | "denied" | "prompt" | "unavailable";
  request: () => Promise<"granted" | "denied">;
  affectedFeatures: string; // i18n key
}

const DISMISSED_KEY = "meercop_permissions_dismissed";
const REQUEST_TIMEOUT_MS = 7000;
const NATIVE_DETECTION_MAX_WAIT_MS = 2000;
const NATIVE_DETECTION_POLL_MS = 120;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNativeRuntimeSignal(): Promise<boolean> {
  if (isRunningInNativeApp()) return true;

  const ua = navigator.userAgent || "";
  const isMobileRuntime = /Android|iPhone|iPad|iPod/i.test(ua);
  if (!isMobileRuntime) return false;

  const deadline = Date.now() + NATIVE_DETECTION_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(NATIVE_DETECTION_POLL_MS);
    if (isRunningInNativeApp()) return true;
  }

  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function requestNotificationPermission(): Promise<"granted" | "denied"> {
  if (!("Notification" in window)) return "denied";

  try {
    return await withTimeout(
      Notification.requestPermission().then((result) => result === "granted" ? "granted" : "denied"),
      REQUEST_TIMEOUT_MS,
      "denied"
    );
  } catch {
    return "denied";
  }
}

async function requestCameraPermission(): Promise<"granted" | "denied"> {
  if (!navigator.mediaDevices?.getUserMedia) return "denied";

  try {
    return await withTimeout(
      navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        return "granted" as const;
      }),
      REQUEST_TIMEOUT_MS,
      "denied"
    );
  } catch {
    return "denied";
  }
}

async function requestGeolocationPermission(): Promise<"granted" | "denied"> {
  if (!navigator.geolocation) return "denied";

  try {
    return await withTimeout(
      new Promise<"granted" | "denied">((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve("granted"),
          () => resolve("denied"),
          { timeout: 5000, maximumAge: 0, enableHighAccuracy: false }
        );
      }),
      REQUEST_TIMEOUT_MS,
      "denied"
    );
  } catch {
    return "denied";
  }
}

export function usePermissionCheck() {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [shouldShow, setShouldShow] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkPermissions = useCallback(async () => {
    // 네이티브 환경 감지 타이밍 이슈 방지: 짧게 재확인
    if (!isRunningInNativeApp()) {
      await sleep(NATIVE_DETECTION_RETRY_MS);
    }

    // 네이티브 앱에서는 앱 레벨에서 권한을 처리하므로 웹 권한 팝업 스킵
    if (isRunningInNativeApp()) {
      console.log("[PermissionCheck] Native app detected, skipping web permission popup");
      setPermissions([]);
      setShouldShow(false);
      setChecked(true);
      return;
    }

    const items: PermissionItem[] = [];

    // 1. Notification
    if ("Notification" in window) {
      const status = Notification.permission === "default" ? "prompt" : Notification.permission as "granted" | "denied";
      items.push({
        key: "notification",
        name: "permissions.notification",
        description: "permissions.notificationDesc",
        status,
        request: requestNotificationPermission,
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
        request: requestCameraPermission,
        affectedFeatures: "permissions.cameraFeatures",
      });
    } catch {
      // permissions API not supported for camera
      items.push({
        key: "camera",
        name: "permissions.camera",
        description: "permissions.cameraDesc",
        status: "prompt",
        request: requestCameraPermission,
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
        request: requestGeolocationPermission,
        affectedFeatures: "permissions.locationFeatures",
      });
    } catch {
      items.push({
        key: "geolocation",
        name: "permissions.location",
        description: "permissions.locationDesc",
        status: "prompt",
        request: requestGeolocationPermission,
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

