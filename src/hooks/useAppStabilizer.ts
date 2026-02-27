import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { channelManager } from "@/lib/channelManager";
import { useQueryClient } from "@tanstack/react-query";

/**
 * useAppStabilizer — 앱 장시간 실행 안정화
 * 
 * 1. 포그라운드 복귀 시 감시 상태 DB 재확인 + React Query 갱신
 * 2. Realtime 채널 건강성 체크 + 자동 재연결
 * 3. 메모리 누수 방지를 위한 주기적 캐시 정리
 */
export function useAppStabilizer() {
  const { effectiveUserId } = useAuth();
  const queryClient = useQueryClient();
  const lastSyncRef = useRef<number>(0);
  const memoryCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncOnForeground = useCallback(async () => {
    if (!effectiveUserId) return;

    const now = Date.now();
    if (now - lastSyncRef.current < 3000) return;
    lastSyncRef.current = now;

    console.log("[Stabilizer] 🔄 Foreground sync started");

    try {
      await queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });

      const channels = supabase.getChannels();
      for (const ch of channels) {
        const state = (ch as unknown as { state?: string }).state;
        if (state === "errored" || state === "closed") {
          console.warn(`[Stabilizer] ♻️ Unhealthy channel detected: ${ch.topic}, triggering reconnect`);
          window.dispatchEvent(new CustomEvent("channelmanager:reconnect", { detail: { name: ch.topic } }));
        }
      }

      console.log("[Stabilizer] ✅ Foreground sync complete");
    } catch (err) {
      console.error("[Stabilizer] Sync error:", err);
    }
  }, [effectiveUserId, queryClient]);

  useEffect(() => {
    if (!effectiveUserId) return;

    // visibilitychange → 포그라운드 복귀 시 동기화
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncOnForeground();
      }
    };

    // online 이벤트 → 네트워크 복구 시 동기화
    const handleOnline = () => {
      console.log("[Stabilizer] 🌐 Network restored");
      syncOnForeground();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);

    // 메모리 누수 방지: 10분마다 오래된 Query 캐시 정리
    memoryCycleRef.current = setInterval(() => {
      queryClient.removeQueries({
        predicate: (query) => {
          const state = query.state;
          // 10분 이상 사용되지 않은 inactive 쿼리 제거
          return (
            state.fetchStatus === "idle" &&
            Date.now() - state.dataUpdatedAt > 10 * 60 * 1000
          );
        },
      });
    }, 10 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      if (memoryCycleRef.current) clearInterval(memoryCycleRef.current);
    };
  }, [effectiveUserId, syncOnForeground, queryClient]);
}
