// src/lib/broadcastCommand.ts
// 통합 명령 브로드캐스트 유틸리티
// 모든 명령은 user-commands-${userId} 채널을 통해 전송
// 노트북은 이 채널을 구독하여 device_id 필드로 대상 기기를 식별

import { supabase } from "@/integrations/supabase/client";

interface BroadcastOptions {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * user-commands-${userId} 채널로 명령을 브로드캐스트합니다.
 * - userId 기반이므로 device_id 불일치 문제가 없습니다.
 * - 페이로드에 반드시 device_id를 포함해야 노트북이 대상 기기를 식별할 수 있습니다.
 * - best-effort: 실패해도 예외를 던지지 않습니다.
 */
export async function broadcastCommand({
  userId,
  event,
  payload,
  timeoutMs = 5000,
}: BroadcastOptions): Promise<void> {
  const channelName = `user-commands-${userId}`;

  // 기존 동일 이름 채널 제거 (충돌 방지)
  const existing = supabase.getChannels().find(
    (ch) => ch.topic === `realtime:${channelName}`
  );
  if (existing) supabase.removeChannel(existing);

  const channel = supabase.channel(channelName);

  try {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        supabase.removeChannel(channel);
        resolve();
      }, timeoutMs);

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          channel.send({ type: "broadcast", event, payload })
            .then(() => {
              console.log(`[broadcastCommand] ✅ ${event} sent via ${channelName}`, payload);
              supabase.removeChannel(channel);
              resolve();
            });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          resolve();
        }
      });
    });
  } catch (err) {
    console.warn(`[broadcastCommand] ⚠️ ${event} broadcast failed (best-effort):`, err);
  }
}
