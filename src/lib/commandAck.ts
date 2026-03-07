// 명령 ACK(확인 응답) 리스너
// 노트북이 명령을 수신하면 동일 채널로 "command_ack" 이벤트를 보냄
// 스마트폰은 이를 수신하여 사용자에게 확인 피드백을 제공

import { supabase } from "@/integrations/supabase/client";

interface WaitForAckOptions {
  /** 대상 기기 ID (device-commands-${deviceId} 채널 사용) */
  deviceId: string;
  /** 원래 보낸 이벤트명 (e.g. "monitoring_toggle") */
  event: string;
  /** 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 노트북으로부터 command_ack 이벤트를 대기합니다.
 * - 성공: true 반환
 * - 타임아웃: false 반환
 */
export function waitForCommandAck({
  deviceId,
  event,
  timeoutMs = 6000,
}: WaitForAckOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const channelName = `ack-listener-${deviceId}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      resolve(false);
    }, timeoutMs);

    channel
      .on("broadcast", { event: "command_ack" }, ({ payload }) => {
        // ACK 페이로드에서 원래 이벤트명 확인
        if (payload?.ack_event === event && payload?.device_id === deviceId) {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          resolve(true);
        }
      })
      .subscribe();
  });
}
