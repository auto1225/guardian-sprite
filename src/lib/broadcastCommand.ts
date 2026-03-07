// src/lib/broadcastCommand.ts
// 명령 브로드캐스트 유틸리티
// 항상 user-commands-${userId} 채널로 전송
// payload에 device_id가 있으면 device-commands-${deviceId}에도 동시 전송 (하위 호환)

import { supabase } from "@/integrations/supabase/client";

interface BroadcastOptions {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  /** @deprecated 사용하지 않음. payload.device_id로 자동 감지 */
  targetDeviceId?: string;
}

/**
 * 명령을 브로드캐스트합니다.
 * 1) user-commands-${userId} 채널로 전송 (주 채널)
 * 2) payload.device_id가 있으면 device-commands-${deviceId}에도 전송 (하위 호환)
 * - best-effort: 실패해도 예외를 던지지 않습니다.
 */
export async function broadcastCommand({
  userId,
  event,
  payload,
  timeoutMs = 5000,
}: BroadcastOptions): Promise<void> {
  const channels: string[] = [`user-commands-${userId}`];

  // ★ payload에 device_id가 있으면 device-commands 채널에도 전송 (하위 호환)
  const deviceId = payload.device_id as string | undefined;
  if (deviceId) {
    channels.push(`device-commands-${deviceId}`);
  }

  // 모든 채널에 병렬 전송
  await Promise.all(channels.map(channelName => sendToChannel(channelName, event, payload, timeoutMs)));
}

async function sendToChannel(
  channelName: string,
  event: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  // ★ 기존 활성 채널이 있으면 재사용 (useDevices 등의 영구 구독 보호)
  const existing = supabase.getChannels().find(
    (ch) => ch.topic === `realtime:${channelName}`
  );

  if (existing) {
    try {
      await existing.send({ type: "broadcast", event, payload });
      console.log(`[broadcastCommand] ✅ ${event} sent via existing ${channelName}`);
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
              console.log(`[broadcastCommand] ✅ ${event} sent via temp ${channelName}`);
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
    console.warn(`[broadcastCommand] ⚠️ ${event} broadcast to ${channelName} failed:`, err);
  }
}
