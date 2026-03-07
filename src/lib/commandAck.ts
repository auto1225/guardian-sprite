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
  /** 대상 기기 ID (공유 DB) */
  deviceId: string;
  /** 대상 기기명 (cross-DB ID 불일치 시 fallback 매칭) */
  deviceName?: string;
  /** 대상 기기 시리얼 키 (가장 신뢰할 수 있는 매칭 기준) */
  serialKey?: string;
  /** 원래 보낸 이벤트명 (e.g. "monitoring_toggle") */
  event: string;
  /** 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 노트북으로부터 command_ack를 대기합니다.
 * useDevices 훅이 user-commands 채널에서 command_ack를 수신하면
 * dispatchCommandAck()를 호출 → 여기서 CustomEvent로 수신합니다.
 *
 * 매칭 기준 (우선순위):
 * 1. serial_key 일치 (cross-DB 환경에서 가장 신뢰)
 * 2. device_id 일치
 * 3. device_name 일치
 */
export function waitForCommandAck({
  deviceId,
  deviceName,
  serialKey,
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
      const ackDeviceName = payload?.device_name;
      const ackSerialKey = payload?.serial_key;

      if (ackEvent !== event) return;

      // ★ 매칭 우선순위: serial_key > device_id > device_name
      const serialMatched = serialKey && ackSerialKey && ackSerialKey === serialKey;
      const idMatched = ackDeviceId === deviceId;
      const nameMatched = deviceName && ackDeviceName && ackDeviceName === deviceName;

      if (serialMatched || idMatched || nameMatched) {
        const matchType = serialMatched ? `serial=${serialKey}` : idMatched ? `id=${deviceId}` : `name=${deviceName}`;
        console.log(`[commandAck] ✅ ACK matched for ${event}:`, matchType, payload);
        clearTimeout(timeout);
        cleanup();
        resolve(true);
      }
    };

    window.addEventListener("command_ack", handler);
  });
}
