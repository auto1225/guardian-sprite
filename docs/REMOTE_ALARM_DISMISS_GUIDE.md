# 원격 경보 해제 - 노트북 앱 구현 가이드

## 개요

이 문서는 노트북 앱과 스마트폰 앱 간의 **경보 상태 동기화** 전체 흐름을 설명합니다.

> ⚠️ **채널 아키텍처 변경 (2026-02)**: `device-alerts-${deviceId}` → `user-alerts-${userId}`로 변경되었습니다. 모든 페이로드에 `device_id`를 포함하여 기기를 식별합니다.

핵심 원칙:
1. **노트북이 경보 발생 시 Presence로 `active_alert`를 전송**해야 스마트폰이 경보를 감지합니다.
2. 스마트폰이 "경보 해제" 버튼을 누르면 Broadcast로 해제 신호를 전송합니다.
3. 노트북은 해제 신호를 감지하여 경보음을 중단합니다.

---

## ⚠️ 가장 중요: 노트북이 경보 발생 시 해야 할 일

**노트북 앱이 경보를 발생시킬 때 반드시 Presence 채널에 `active_alert` 상태를 전송해야 합니다.**

### 노트북 → 스마트폰: 경보 발생 알림

```javascript
const USER_ID = "your-user-id-here";
const DEVICE_ID = "your-device-id-here";

// 경보 발생 시 호출
async function triggerAlert(alertType, title, message) {
  const alertId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // ✅ 사용자별 채널 사용, key로 기기 식별
  const channel = supabase.channel(`user-alerts-${USER_ID}`);
  
  await channel.subscribe();
  
  // ✅ 핵심: key=DEVICE_ID로 track, active_alert 포함
  await channel.track({
    active_alert: {
      id: alertId,
      type: alertType,
      title: title,
      message: message,
      device_id: DEVICE_ID,   // ✅ 어떤 기기의 경보인지 식별
      created_at: new Date().toISOString(),
    },
    last_seen_at: new Date().toISOString(),
  });
  
  console.log("[Laptop] 경보 전송 완료:", alertId);
}
```

### 전송 데이터 형식

```json
{
  "active_alert": {
    "id": "1707834567890-a1b2c3d4e",
    "type": "intrusion",
    "title": "키보드 감지!",
    "message": "노트북에서 키보드 입력이 감지되었습니다.",
    "device_id": "3d9b2272-b398-400f-9624-0e2c924deab1",
    "created_at": "2026-02-12T19:27:58.512Z"
  },
  "last_seen_at": "2026-02-12T19:27:58.512Z"
}
```

> ⚠️ **이 단계가 누락되면 스마트폰에서 경보를 감지할 수 없습니다!**

---

## 1. 채널 구독 (노트북 앱 시작 시)

노트북 앱은 시작 시 `user-alerts-${userId}` 채널을 구독하고, **Broadcast** 이벤트로 원격 해제 신호를 감지합니다.

```javascript
const USER_ID = "your-user-id-here";
const DEVICE_ID = "your-device-id-here";

const channel = supabase.channel(`user-alerts-${USER_ID}`);

channel
  .on('broadcast', { event: 'remote_alarm_off' }, (payload) => {
    // ✅ 자기 기기에 대한 해제인지 확인
    if (payload.payload?.device_id !== DEVICE_ID) return;
    
    console.log("[Laptop] 원격 경보 해제 신호 수신:", payload);
    stopAlarmSound();
    clearAlertState();
  })
  .subscribe();
```

---

## 2. 스마트폰이 전송하는 Broadcast 데이터

스마트폰에서 "🔇 컴퓨터 경보음 해제" 버튼을 누르면:

```javascript
channel.send({
  type: 'broadcast',
  event: 'remote_alarm_off',
  payload: {
    device_id: DEVICE_ID,              // ✅ 대상 기기 ID
    dismissed_at: "2026-02-12T19:27:58.512Z",
    remote_alarm_off: true,
    role: 'phone',                     // ✅ 스마트폰에서 보냄을 식별
  },
});
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `event` | `string` | `"remote_alarm_off"` — 이벤트 이름 |
| `device_id` | `string` | 대상 기기 ID |
| `remote_alarm_off` | `boolean` | `true`이면 경보음 즉시 해제 |
| `dismissed_at` | `string (ISO 8601)` | 해제 시각 |
| `role` | `string` | `"phone"` — 스마트폰에서 보냈음을 표시 |

---

## 3. 경보음 중단 함수 예시

```javascript
let alarmAudioContext = null;
let alarmInterval = null;

function stopAlarmSound() {
  if (alarmAudioContext) {
    alarmAudioContext.close();
    alarmAudioContext = null;
  }
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  const audioElement = document.getElementById('alarm-audio');
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
  }
  console.log("[Laptop] 경보음이 해제되었습니다.");
}

function clearAlertState() {
  console.log("[Laptop] 경보 상태가 초기화되었습니다.");
}
```

---

## 4. PIN 필요 여부 확인 (로컬 해제 시)

`devices.metadata.require_pc_pin` 값에 따라 **노트북에서 직접 경보를 해제할 때**만 PIN을 요구합니다.

```javascript
const requirePcPin = device?.metadata?.require_pc_pin ?? false;
const alarmPin = device?.metadata?.alarm_pin ?? "0000";

function handleLocalDismiss() {
  if (requirePcPin) {
    showPinPad(alarmPin);
  } else {
    stopAlarmSound();
    clearAlertState();
  }
}
```

> ⚠️ **중요**: `remote_alarm_off: true` 신호는 PIN 확인 없이 **즉시** 경보음을 중단해야 합니다.

---

## 5. 전체 흐름 요약

```
[경보 발생 흐름]
노트북 센서 감지 (키보드, 마우스, 덮개 등)
  ↓
channel(user-alerts-${userId}).track({ active_alert: { ..., device_id } }, key: deviceId)
  ↓
스마트폰 useAlerts Presence sync → activeAlert 상태 업데이트
  ↓
스마트폰 UI에 경보 모드 + "🔇 컴퓨터 경보음 해제" 버튼 표시

[원격 해제 흐름]
스마트폰 "🔇 컴퓨터 경보음 해제" 버튼 클릭
  ↓
channel.send({ type: 'broadcast', event: 'remote_alarm_off', payload: { device_id, dismissed_at, role: 'phone' } })
  ↓
노트북 앱 broadcast 이벤트 수신 → device_id 확인
  ↓
remote_alarm_off === true → stopAlarmSound() 즉시 호출 (PIN 불필요)
```

---

## 6. metadata 내 관련 설정 필드

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `require_pc_pin` | `boolean` | `false` | 노트북 로컬 경보 해제 시 PIN 필요 여부 |
| `alarm_pin` | `string` | `"0000"` | 경보 해제 PIN (4자리) |
| `alarm_sound_id` | `string` | `"default"` | 사용할 경보음 ID |

---

## 주의사항

1. **채널 이름은 `user-alerts-${userId}`**를 사용하고, `device_id`로 기기를 식별합니다.
2. **원격 해제(`remote_alarm_off`)는 항상 PIN 없이 즉시 실행**해야 합니다.
3. **로컬 해제는 `require_pc_pin` 설정에 따라** PIN 입력을 요구할 수 있습니다.
4. 채널은 앱 시작 시 구독하고, 앱 종료 시 해제해야 합니다.
5. 네트워크 끊김 시 자동 재연결 로직을 포함해야 합니다.
6. `active_alert.id`는 경보마다 고유해야 스마트폰에서 중복 경보음 재생을 방지할 수 있습니다.
