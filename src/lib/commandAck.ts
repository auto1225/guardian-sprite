// 명령 ACK(확인 응답) 리스너
// 노트북이 명령을 수신·적용하면 동일 채널로 "command_ack" 이벤트를 브로드캐스트
// 스마트폰은 이를 수신하여 사용자에게 확인 피드백을 제공

import { supabase } from "@/integrations/supabase/client";

interface WaitForAckOptions {
  /** 대상 기기 ID */
  deviceId: string;
  /** userId (user-commands 채널 수신용) */
  userId: string;
  /** 원래 보낸 이벤트명 (e.g. "monitoring_toggle") */
  event: string;
  /** 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 노트북으로부터 command_ack 이벤트를 대기합니다.
 * device-commands 및 user-commands 채널 모두 수신합니다.
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
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      channels.forEach((ch) => supabase.removeChannel(ch));
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handleAck = ({ payload }: { payload: Record<string, unknown> }) => {
      if (payload?.ack_event === event && payload?.device_id === deviceId) {
        clearTimeout(timeout);
        cleanup();
        resolve(true);
      }
    };

    // 기기별 채널에서 ACK 수신
    const deviceCh = supabase.channel(`ack-device-${deviceId}-${Date.now()}`);
    deviceCh
      .on("broadcast", { event: "command_ack" }, handleAck)
      .subscribe();
    channels.push(deviceCh);

    // 사용자 통합 채널에서도 ACK 수신
    const userCh = supabase.channel(`ack-user-${userId}-${Date.now()}`);
    userCh
      .on("broadcast", { event: "command_ack" }, handleAck)
      .subscribe();
    channels.push(userCh);
  });
}
