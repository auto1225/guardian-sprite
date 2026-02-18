/**
 * usePushSubscription — 웹 푸시 알림 구독 관리 훅
 *
 * 기능:
 *   1. VAPID 공개키를 edge function에서 조회
 *   2. PushManager를 통해 브라우저 푸시 구독
 *   3. 구독 정보를 DB에 저장
 *   4. 구독 상태 추적
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface PushState {
  isSupported: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission | "unknown";
  isLoading: boolean;
  error: string | null;
}

export function usePushSubscription(deviceId?: string | null) {
  const [state, setState] = useState<PushState>({
    isSupported: false,
    isSubscribed: false,
    permission: "unknown",
    isLoading: false,
    error: null,
  });

  const subscribeAttemptedRef = useRef(false);

  // 브라우저 지원 및 기존 구독 확인
  useEffect(() => {
    const check = async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!supported) {
        setState((s) => ({ ...s, isSupported: false, permission: "unknown" }));
        return;
      }

      const permission = Notification.permission;

      try {
        const reg = await navigator.serviceWorker.ready;
        const pm = (reg as unknown as { pushManager: PushManager }).pushManager;
        if (!pm) {
          setState((s) => ({ ...s, isSupported: true, permission }));
          return;
        }
        const sub = await pm.getSubscription();
        setState((s) => ({
          ...s,
          isSupported: true,
          isSubscribed: !!sub,
          permission,
        }));
      } catch {
        setState((s) => ({ ...s, isSupported: true, permission }));
      }
    };

    check();
  }, []);

  // pushsubscriptionchange 메시지 수신 시 재구독
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        console.log("[usePush] Subscription changed, re-subscribing...");
        subscribe();
      }
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, []);

  const subscribe = useCallback(async () => {
    if (!deviceId) return;
    if (state.isLoading) return;

    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // 1. 알림 권한 요청
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => ({
          ...s,
          isLoading: false,
          permission,
          error: "알림 권한이 거부되었습니다.",
        }));
        return;
      }

      // 2. VAPID 공개키 조회
      const { data: vapidData, error: vapidErr } = await supabase.functions.invoke(
        "push-notifications",
        { body: { action: "get-vapid-key" } }
      );

      if (vapidErr || !vapidData?.vapidPublicKey) {
        throw new Error("VAPID 키 조회 실패");
      }

      // 3. applicationServerKey 변환
      const applicationServerKey = urlBase64ToUint8Array(vapidData.vapidPublicKey);

      // 4. PushManager 구독
      const reg = await navigator.serviceWorker.ready;
      const pm = (reg as unknown as { pushManager: PushManager }).pushManager;

      // 기존 구독 해제 후 새로 구독 (VAPID 키 불일치 방지)
      const existingSub = await pm.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }

      const subscription = await pm.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      const subJson = subscription.toJSON();

      // 5. Edge function으로 구독 저장
      const { error: subErr } = await supabase.functions.invoke(
        "push-notifications",
        {
          body: {
            action: "subscribe",
            subscription: {
              endpoint: subJson.endpoint,
              keys: {
                p256dh: subJson.keys?.p256dh,
                auth: subJson.keys?.auth,
              },
            },
            device_id: deviceId,
          },
        }
      );

      if (subErr) throw new Error("구독 저장 실패");

      setState((s) => ({
        ...s,
        isLoading: false,
        isSubscribed: true,
        permission: "granted",
      }));

      console.log("[usePush] ✅ Push subscription saved");
    } catch (err: any) {
      console.error("[usePush] Subscribe error:", err);
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err?.message || "푸시 구독 실패",
      }));
    }
  }, [deviceId, state.isLoading]);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await (reg as unknown as { pushManager: PushManager }).pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();

        // DB에서도 삭제
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", endpoint);
      }

      setState((s) => ({ ...s, isSubscribed: false }));
      console.log("[usePush] ✅ Unsubscribed");
    } catch (err) {
      console.error("[usePush] Unsubscribe error:", err);
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
  };
}

// ── URL-safe base64 → Uint8Array ──
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
