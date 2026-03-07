// 명령 ACK(확인 응답) 리스너
// 노트북이 명령을 수신·적용하면 user-commands-${userId} 채널로 "command_ack" 이벤트를 브로드캐스트
// 스마트폰은 동일 채널을 구독하여 ACK를 수신

import { supabase } from "@/integrations/supabase/client";

interface WaitForAckOptions {
  /** 대상 기기 ID */
  deviceId: string;
  /** userId (user-commands-${userId} 채널 수신용) */
  userId: string;
  /** 원래 보낸 이벤트명 (e.g. "monitoring_toggle") */
  event: string;
  /** 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 노트북으로부터 command_ack 이벤트를 대기합니다.
 * 노트북이 ACK를 보내는 실제 채널명(user-commands-${userId})을 구독합니다.
 * - 성공: true 반환
 * - 타임아웃: false 반환
 */
export function waitForCommandAck({
  deviceId,
  userId,
  event,
  timeoutMs = 8000,
}: WaitForAckOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      supabase.removeChannel(channel);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    // ★ 노트북이 ACK를 보내는 실제 채널명과 동일하게 구독
    const channelName = `user-commands-${userId}`;

    // 기존 동일 이름 채널이 있으면 재사용할 수 없으므로 고유 접미사 추가
    // 하지만 Supabase broadcast는 같은 topic(채널명)을 공유해야 수신 가능
    // → 이미 구독 중인 채널이 있으면 그 채널에 리스너를 붙이는 대신,
    //   동일 topic으로 새 채널을 생성하여 수신
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "command_ack" }, ({ payload }) => {
        // payload.command 또는 payload.ack_event 모두 체크 (노트북 구현 호환)
        const ackEvent = payload?.ack_event || payload?.command;
        const ackDeviceId = payload?.device_id;

        if (ackEvent === event && ackDeviceId === deviceId) {
          console.log(`[commandAck] ✅ ACK received for ${event} from ${deviceId}`, payload);
          clearTimeout(timeout);
          cleanup();
          resolve(true);
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[commandAck] ⚠️ Channel ${channelName} subscription failed:`, status);
          clearTimeout(timeout);
          cleanup();
          resolve(false);
        }
      });
  });
}
