// 명령 ACK(확인 응답) 리스너
// 노트북이 명령을 수신·적용하면 user-commands-${userId} 채널로 "command_ack" 이벤트를 브로드캐스트
// 스마트폰은 CustomEvent를 통해 ACK를 수신 (채널 중복 구독 방지)

/**
 * command_ack 이벤트를 디스패치합니다.
 * useDevices 등 이미 user-commands 채널을 구독하는 훅에서 호출합니다.
 */
export function dispatchCommandAck(payload: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("command_ack", { detail: payload }));
}

interface WaitForAckOptions {
  /** 대상 기기 ID */
  deviceId: string;
  /** 원래 보낸 이벤트명 (e.g. "monitoring_toggle") */
  event: string;
  /** 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 노트북으로부터 command_ack를 대기합니다.
 * useDevices 훅이 user-commands 채널에서 command_ack를 수신하면
 * dispatchCommandAck()를 호출 → 여기서 CustomEvent로 수신합니다.
 * - 성공: true
 * - 타임아웃: false
 */
export function waitForCommandAck({
  deviceId,
  event,
  timeoutMs = 8000,
}: WaitForAckOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("command_ack", handler);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handler = (e: Event) => {
      const payload = (e as CustomEvent).detail;
      const ackEvent = payload?.ack_event || payload?.command;
      const ackDeviceId = payload?.device_id;

      if (ackEvent === event && ackDeviceId === deviceId) {
        console.log(`[commandAck] ✅ ACK received for ${event} from ${deviceId}`, payload);
        clearTimeout(timeout);
        cleanup();
        resolve(true);
      }
    };

    window.addEventListener("command_ack", handler);
  });
}
