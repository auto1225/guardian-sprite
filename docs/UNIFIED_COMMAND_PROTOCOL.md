# 📡 MeerCOP 통합 명령 프로토콜 (Unified Command Protocol)

> **최종 업데이트**: 2026-02-28

## 🔑 핵심 원칙

**모든 명령은 `user-commands-${userId}` 채널을 통해 전송합니다.**

- ❌ ~~`device-commands-${deviceId}`~~ — device_id 불일치(공유DB vs 로컬DB) 위험
- ✅ `user-commands-${userId}` — userId는 시리얼 인증에서 오므로 절대 불일치 없음
- 페이로드에 반드시 `device_id`를 포함하여 노트북이 대상 기기를 식별

---

## 📋 채널 구조

| 채널 이름 | 방향 | 용도 |
|-----------|------|------|
| `user-commands-${userId}` | 📱→💻 | 모든 명령 전송 |
| `user-presence-${userId}` | 💻↔📱 | 기기 온/오프라인, 배터리 등 |
| `user-alerts-${userId}` | 💻→📱 | 경보 발생/해제 |
| `user-photos-${userId}` | 💻→📱 | 사진 경보 전송 |

### 명령 요약표

| # | 이벤트 | 방향 | 설명 |
|---|--------|------|------|
| 1 | `monitoring_toggle` | 📱→💻 | 감시 ON/OFF |
| 2 | `camouflage_toggle` | 📱→💻 | 위장 모드 ON/OFF |
| 3 | `settings_updated` | 📱→💻 | 센서/PIN/민감도 등 설정 변경 |
| 4 | `lock_command` | 📱→💻 | 화면 잠금 |
| 5 | `message_command` | 📱→💻 | 팝업 메시지 표시 |
| 6 | `alarm_dismiss` | 📱→💻 | 경보음 원격 해제 |
| 7 | `mascot_toggle` | 📱→💻 | 마스코트/말풍선 보기·숨기기 |

---

## 📨 명령 이벤트 목록

### 1. `monitoring_toggle`
감시 ON/OFF 토글

```json
{
  "device_id": "uuid",
  "is_monitoring": true
}
```

### 2. `camouflage_toggle`
위장 모드 ON/OFF

```json
{
  "device_id": "uuid",
  "camouflage_mode": true
}
```

### 3. `settings_updated`
센서 설정, PIN, 민감도 등 변경

```json
{
  "device_id": "uuid",
  "settings": {
    "sensorSettings": { ... },
    "alarm_pin": "1234",
    "alarm_pin_hash": "sha256...",
    "alarm_sound_id": "whistle",
    "require_pc_pin": true,
    "motionSensitivity": "insensitive",
    "mouseSensitivity": "sensitive",
    "language": "ko"
  }
}
```

### 4. `lock_command`
화면 잠금

```json
{
  "device_id": "uuid"
}
```

### 5. `message_command`
팝업 메시지 표시

```json
{
  "device_id": "uuid",
  "message": "돌아와!",
  "title": "경고"
}
```

### 6. `alarm_dismiss`
컴퓨터 경보음 원격 해제 (📱→💻)

```json
{
  "device_id": "uuid",
  "dismissed_at": "2026-02-28T12:00:00.000Z",
  "dismissed_by": "smartphone",
  "remote_alarm_off": true
}
```

### 7. `mascot_toggle`
마스코트 캐릭터 및 말풍선 보기/숨기기 (📱→💻)

```json
{
  "device_id": "uuid",
  "mascot_visible": true
}
```

> - `mascot_visible: true` → 캐릭터 + 말풍선 표시
> - `mascot_visible: false` → 캐릭터 + 말풍선 숨김
> - DB `metadata.mascot_visible`에도 동기화하여 새로고침 후에도 상태 유지

---

## 📬 명령 확인 응답 (Command ACK)

노트북이 명령을 수신·적용한 후, 동일 채널로 `command_ack` 이벤트를 브로드캐스트하여 스마트폰에 확인 피드백을 제공합니다.

### ACK 페이로드 형식

```json
{
  "device_id": "uuid",
  "ack_event": "monitoring_toggle",
  "success": true,
  "timestamp": "2026-03-07T12:00:00.000Z"
}
```

### ACK 지원 이벤트

| 원본 이벤트 | ACK 응답 |
|-------------|----------|
| `monitoring_toggle` | ✅ 필수 |
| `camouflage_toggle` | ✅ 필수 |
| `settings_updated` | 선택 |
| `lock_command` | 선택 |
| `message_command` | 선택 |

### 스마트폰 동작
1. 명령 전송 후 "전송됨" 토스트 표시
2. 8초간 `command_ack` 이벤트 대기
3. ACK 수신 → "✅ 노트북에 적용 확인" 토스트
4. 타임아웃 → "⚠️ 노트북 응답 없음" 경고 토스트

### 노트북 (송신측) 구현

```typescript
// 명령 수신 후 처리 완료 시 ACK 전송
channel.send({
  type: "broadcast",
  event: "command_ack",
  payload: {
    device_id: myDeviceId,
    ack_event: "monitoring_toggle",
    success: true,
    timestamp: new Date().toISOString(),
  },
});
```

---

## 🔧 구현 가이드

### 스마트폰 (송신측)

```typescript
import { broadcastCommand } from "@/lib/broadcastCommand";

await broadcastCommand({
  userId: effectiveUserId,
  event: "monitoring_toggle",
  payload: { device_id: deviceId, is_monitoring: true },
});
```

### 노트북 (수신측)

```typescript
// user-commands-${userId} 채널 구독
const channel = supabase.channel(`user-commands-${userId}`);
channel
  .on("broadcast", { event: "monitoring_toggle" }, ({ payload }) => {
    handleMonitoringToggle(payload);
  })
  .on("broadcast", { event: "camouflage_toggle" }, ({ payload }) => {
    handleCamouflageToggle(payload);
  })
  .on("broadcast", { event: "settings_updated" }, ({ payload }) => {
    handleSettingsUpdate(payload);
  })
  .on("broadcast", { event: "lock_command" }, ({ payload }) => {
    handleLockCommand(payload);
  })
  .on("broadcast", { event: "message_command" }, ({ payload }) => {
    handleMessageCommand(payload);
  })
  .on("broadcast", { event: "alarm_dismiss" }, ({ payload }) => {
    handleAlarmDismiss(payload);
  })
  .on("broadcast", { event: "mascot_toggle" }, ({ payload }) => {
    // ★ 마스코트 보기/숨기기 — metadata.mascot_visible 동기화
    handleMascotToggle(payload);
  })
  .subscribe();
```

---

## ⚠️ 주의사항

1. **DB 업데이트 먼저**: 모든 명령은 Edge Function으로 DB 상태를 먼저 변경한 후 브로드캐스트
2. **best-effort**: 브로드캐스트 실패해도 DB는 이미 업데이트되었으므로 에러를 던지지 않음
3. **하위 호환**: 노트북은 `device-commands-${deviceId}`도 동시에 구독하여 전환 기간 호환 유지
4. **userId 소스**: 시리얼 인증(`validate-serial`)에서 반환된 `user_id` 사용
