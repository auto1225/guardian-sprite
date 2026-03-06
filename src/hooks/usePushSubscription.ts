/**
 * usePushSubscription — 웹 푸시 알림 구독 관리 훅
 *
 * 기능:
 *   1. VAPID 공개키를 edge function에서 조회
 *   2. PushManager를 통해 브라우저 푸시 구독
 *   3. 구독 정보를 DB에 저장
 *   4. 구독 상태 추적
 *
 * 수정 이력:
 *   v2: applicationServerKey를 Uint8Array로 직접 전달 (모바일 호환성)
 *       isLoading을 ref로 관리하여 stale closure 방지
 *       상세 단계별 에러 로깅 추가
 *       자동 재시도 로직 추가
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

  const isLoadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 2;

  // 브라우저 지원 및 기존 구독 확인
  useEffect(() => {
    const check = async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!supported) {
        console.warn("[usePush] ❌ Push not supported in this browser");
        setState((s) => ({ ...s, isSupported: false, permission: "unknown" }));
        return;
      }

      const permission = Notification.permission;
      console.log("[usePush] Browser support: ✅, Permission:", permission);

      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager?.getSubscription();
        console.log("[usePush] Existing subscription:", sub ? "✅ found" : "❌ none");
        setState((s) => ({
          ...s,
          isSupported: true,
          isSubscribed: !!sub,
          permission,
        }));
      } catch (err) {
        console.warn("[usePush] Check error:", err);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback(async () => {
    if (!deviceId) {
      console.log("[usePush] ⏭️ Skip: no deviceId");
      return;
    }
    if (isLoadingRef.current) {
      console.log("[usePush] ⏭️ Skip: already loading");
      return;
    }

    isLoadingRef.current = true;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // Step 1: 알림 권한 요청
      console.log("[usePush] Step 1: Requesting notification permission...");
      const permission = await Notification.requestPermission();
      console.log("[usePush] Step 1 result:", permission);
      if (permission !== "granted") {
        setState((s) => ({
          ...s,
          isLoading: false,
          permission,
          error: "Notification permission denied.",
        }));
        isLoadingRef.current = false;
        return;
      }

      // Step 2: Service Worker 준비 대기
      console.log("[usePush] Step 2: Waiting for service worker...");
      const reg = await navigator.serviceWorker.ready;
      console.log("[usePush] Step 2: Service worker ready ✅");

      if (!reg.pushManager) {
        throw new Error("PushManager not available on ServiceWorkerRegistration");
      }

      // Step 3: VAPID 공개키 조회
      console.log("[usePush] Step 3: Fetching VAPID key...");
      const { data: vapidData, error: vapidErr } = await supabase.functions.invoke(
        "push-notifications",
        { body: { action: "get-vapid-key" } }
      );

      if (vapidErr || !vapidData?.vapidPublicKey) {
        console.error("[usePush] Step 3 FAILED:", vapidErr, vapidData);
        throw new Error("VAPID 키 조회 실패");
      }
      console.log("[usePush] Step 3: VAPID key received ✅");

      // Step 4: applicationServerKey 변환
      const applicationServerKey = urlBase64ToUint8Array(vapidData.vapidPublicKey);

      // Step 5: 기존 구독 해제 (VAPID 키 불일치 방지)
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        console.log("[usePush] Step 5: Unsubscribing existing subscription...");
        await existingSub.unsubscribe();
      }

      // Step 6: PushManager 구독 — Uint8Array 직접 전달 (모바일 호환성)
      console.log("[usePush] Step 6: Subscribing to PushManager...");
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      console.log("[usePush] Step 6: PushManager subscribed ✅");

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error("Invalid subscription object: missing endpoint or keys");
      }

      // Step 7: Edge function으로 구독 저장
      console.log("[usePush] Step 7: Saving subscription to server...");
      const { error: subErr } = await supabase.functions.invoke(
        "push-notifications",
        {
          body: {
            action: "subscribe",
            subscription: {
              endpoint: subJson.endpoint,
              keys: {
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth,
              },
            },
            device_id: deviceId,
          },
        }
      );

      if (subErr) {
        console.error("[usePush] Step 7 FAILED:", subErr);
        throw new Error("Failed to save subscription");
      }

      setState((s) => ({
        ...s,
        isLoading: false,
        isSubscribed: true,
        permission: "granted",
        error: null,
      }));
      isLoadingRef.current = false;
      retryCountRef.current = 0;

      console.log("[usePush] ✅ Push subscription complete!");
    } catch (err: any) {
      console.error("[usePush] ❌ Subscribe error:", err?.message || err);
      const errorMsg = err?.message || "Push subscription failed";
      setState((s) => ({
        ...s,
        isLoading: false,
        error: errorMsg,
      }));
      isLoadingRef.current = false;

      // 자동 재시도 (최대 2회, 3초 후)
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        console.log(`[usePush] 🔄 Retrying (${retryCountRef.current}/${MAX_RETRIES}) in 3s...`);
        setTimeout(() => {
          isLoadingRef.current = false;
          subscribe();
        }, 3000);
      }
    }
  }, [deviceId]);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager?.getSubscription();
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
