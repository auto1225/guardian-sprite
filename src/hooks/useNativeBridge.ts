/**
 * useNativeBridge — 네이티브 앱 JS Bridge 이벤트 핸들러 등록 훅
 *
 * 기능:
 *   1. window.onNativeToken() — Native에서 전달한 토큰으로 websiteSupabase 세션 복원
 *   2. window.onFCMToken() — FCM 토큰을 수신하여 서버에 저장
 *   3. window.onPushReceived() — 네이티브 푸시 수신 시 앱 내 처리
 *   4. window.isNativeApp() — 네이티브 앱 여부 확인
 */
import { useEffect, useCallback, useRef } from "react";
import { websiteSupabase } from "@/lib/websiteAuth";
import { supabase } from "@/integrations/supabase/client";
import { notifyNativeSessionRestored } from "@/lib/nativeBridge";

interface UseNativeBridgeOptions {
  effectiveUserId: string | null;
  deviceId?: string | null;
}

export function useNativeBridge({ effectiveUserId, deviceId }: UseNativeBridgeOptions) {
  const userIdRef = useRef(effectiveUserId);
  const deviceIdRef = useRef(deviceId);

  useEffect(() => {
    userIdRef.current = effectiveUserId;
  }, [effectiveUserId]);

  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  // ── 1. 토큰 주입 핸들러 ──
  const handleNativeToken = useCallback(async (accessToken: string, refreshToken: string) => {
    console.log("[NativeBridge] ← Native: onNativeToken received");
    try {
      const { data, error } = await websiteSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        console.error("[NativeBridge] Session restore failed:", error.message);
        return;
      }

      console.log("[NativeBridge] ✅ Session restored for:", data.user?.email);
      notifyNativeSessionRestored();
    } catch (err) {
      console.error("[NativeBridge] Token injection error:", err);
    }
  }, []);

  // ── 2. FCM 토큰 저장 핸들러 ──
  const handleFCMToken = useCallback(async (fcmToken: string) => {
    console.log("[NativeBridge] ← Native: onFCMToken received");
    window.__NATIVE_FCM_TOKEN = fcmToken;

    const userId = userIdRef.current;
    if (!userId) {
      console.log("[NativeBridge] FCM token stored locally, waiting for login...");
      return;
    }

    try {
      const { error } = await supabase.functions.invoke("push-notifications", {
        body: {
          action: "subscribe-fcm",
          fcm_token: fcmToken,
          device_id: deviceIdRef.current || null,
          user_id: userId,
        },
      });

      if (error) {
        console.error("[NativeBridge] FCM token save failed:", error);
      } else {
        console.log("[NativeBridge] ✅ FCM token saved to server");
      }
    } catch (err) {
      console.error("[NativeBridge] FCM token save error:", err);
    }
  }, []);

  // ── 3. 푸시 수신 핸들러 ──
  const handlePushReceived = useCallback((payload: Record<string, unknown>) => {
    console.log("[NativeBridge] ← Native: onPushReceived", payload);
    window.dispatchEvent(new CustomEvent("native_push_received", { detail: payload }));
  }, []);

  // ── 4. IAP 결과 핸들러 ──
  const handleIAPResult = useCallback((resultJson: string) => {
    console.log("[NativeBridge] ← Native: onIAPResult", resultJson);
    try {
      const result = JSON.parse(resultJson);
      window.dispatchEvent(new CustomEvent("iap_result", { detail: result }));
    } catch (err) {
      console.error("[NativeBridge] Failed to parse IAP result:", err);
      window.dispatchEvent(new CustomEvent("iap_result", { detail: { success: false, error: "Invalid result" } }));
    }
  }, []);

  // ── 글로벌 핸들러 등록 ──
  useEffect(() => {
    const previousIsNativeApp = window.isNativeApp;

    window.onNativeToken = handleNativeToken;
    window.onFCMToken = handleFCMToken;
    window.onPushReceived = handlePushReceived;
    window.onIAPResult = handleIAPResult;

    if (!previousIsNativeApp) {
      window.isNativeApp = () => !!(window.__IS_NATIVE_APP || window.NativeApp);
    }

    console.log("[NativeBridge] ✅ JS Bridge handlers registered");

    return () => {
      delete window.onNativeToken;
      delete window.onFCMToken;
      delete window.onPushReceived;
      delete window.onIAPResult;
      if (previousIsNativeApp) {
        window.isNativeApp = previousIsNativeApp;
      } else {
        delete window.isNativeApp;
      }
    };
  }, [handleNativeToken, handleFCMToken, handlePushReceived, handleIAPResult]);

  // ── 로그인 후 대기 중인 FCM 토큰 자동 전송 ──
  useEffect(() => {
    if (effectiveUserId && window.__NATIVE_FCM_TOKEN) {
      console.log("[NativeBridge] User logged in, sending pending FCM token...");
      handleFCMToken(window.__NATIVE_FCM_TOKEN);
    }
  }, [effectiveUserId, handleFCMToken]);
}
