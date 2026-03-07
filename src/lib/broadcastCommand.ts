// src/lib/broadcastCommand.ts
// 기기별 독립 명령 브로드캐스트 유틸리티
// targetDeviceId가 있으면 device-commands-${deviceId} 채널로 전송 (기기 독립)
// 없으면 user-commands-${userId} 채널로 전송 (계정 레벨)

import { supabase } from "@/integrations/supabase/client";

interface BroadcastOptions {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  /** 기기별 독립 채널로 전송 (device-commands-${deviceId}) */
  targetDeviceId?: string;
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
  targetDeviceId,
}: BroadcastOptions): Promise<void> {
  const channelName = targetDeviceId
    ? `device-commands-${targetDeviceId}`
    : `user-commands-${userId}`;

  // ★ 기존 활성 채널이 있으면 재사용 (useDevices 등의 영구 구독 보호)
  const existing = supabase.getChannels().find(
    (ch) => ch.topic === `realtime:${channelName}`
  );

  if (existing) {
    // 이미 SUBSCRIBED 상태인 채널로 바로 전송
    try {
      await existing.send({ type: "broadcast", event, payload });
      console.log(`[broadcastCommand] ✅ ${event} sent via existing ${channelName}`, payload);
    } catch (err) {
      console.warn(`[broadcastCommand] ⚠️ ${event} send via existing channel failed:`, err);
    }
    return;
  }

  // 기존 채널이 없으면 임시 채널 생성 → 전송 → 정리
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
              console.log(`[broadcastCommand] ✅ ${event} sent via temp ${channelName}`, payload);
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
