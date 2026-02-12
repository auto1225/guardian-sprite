# 원격 경보 해제 - 노트북 앱 구현 가이드

## 개요

이 문서는 노트북 앱과 스마트폰 앱 간의 **경보 상태 동기화** 전체 흐름을 설명합니다.

핵심 원칙:
1. **노트북이 경보 발생 시 Presence로 `active_alert`를 전송**해야 스마트폰이 경보를 감지합니다.
2. 스마트폰이 "경보 해제" 버튼을 누르면 Presence로 해제 신호를 전송합니다.
3. 노트북은 해제 신호를 감지하여 경보음을 중단합니다.

---

## ⚠️ 가장 중요: 노트북이 경보 발생 시 해야 할 일

**노트북 앱이 경보(침입, 센서 감지 등)를 발생시킬 때 반드시 Presence 채널에 `active_alert` 상태를 전송해야 합니다.** 이것이 없으면 스마트폰은 경보를 감지할 수 없고, "경보 해제" 버튼도 나타나지 않습니다.

### 노트북 → 스마트폰: 경보 발생 알림

```javascript
const DEVICE_ID = "your-device-id-here";

// 경보 발생 시 호출
async function triggerAlert(alertType, title, message) {
  const alertId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const channel = supabase.channel(`device-alerts-${DEVICE_ID}`);
  
  await channel.subscribe();
  
  // ✅ 핵심: active_alert 객체를 Presence로 전송
  await channel.track({
    active_alert: {
      id: alertId,
      type: alertType,        // "intrusion", "unauthorized_peripheral", "location_change" 등
      title: title,            // 예: "키보드 감지!"
      message: message,        // 예: "노트북에서 키보드 입력이 감지되었습니다."
      created_at: new Date().toISOString(),
    },
    last_seen_at: new Date().toISOString(),
  });
  
  console.log("[Laptop] 경보 전송 완료:", alertId);
}

// 사용 예시
triggerAlert("intrusion", "키보드 감지!", "노트북에서 키보드 입력이 감지되었습니다.");
triggerAlert("intrusion", "마우스 감지!", "노트북에서 마우스 움직임이 감지되었습니다.");
triggerAlert("intrusion", "덮개 열림!", "노트북 덮개가 열렸습니다.");
```

### 전송 데이터 형식

```json
{
  "active_alert": {
    "id": "1707834567890-a1b2c3d4e",
    "type": "intrusion",
    "title": "키보드 감지!",
    "message": "노트북에서 키보드 입력이 감지되었습니다.",
    "created_at": "2026-02-12T19:27:58.512Z"
  },
  "last_seen_at": "2026-02-12T19:27:58.512Z"
}
```

> ⚠️ **이 단계가 누락되면 스마트폰에서 경보를 감지할 수 없습니다!**
> 스마트폰의 `useAlerts` 훅은 Presence 채널의 `active_alert` 필드를 감시하여 경보 상태를 판단합니다.

---

## 1. Presence 채널 구독 (노트북 앱 시작 시)

노트북 앱은 시작 시 자신의 `device_id` 기반 Presence 채널을 구독하고, 원격 해제 신호를 감지해야 합니다.

```javascript
const DEVICE_ID = "your-device-id-here";
const channel = supabase.channel(`device-alerts-${DEVICE_ID}`);

channel
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    
    for (const key of Object.keys(state)) {
      const entries = state[key];
      for (const entry of entries) {
        
        // ✅ 원격 경보음 해제 신호 감지
        if (entry.remote_alarm_off === true) {
          console.log("[Laptop] 원격 경보 해제 신호 수신:", entry.dismissed_at);
          stopAlarmSound();  // 경보음 즉시 중단 (PIN 불필요)
        }
        
        // ✅ 전체 경보 해제 신호 감지 (스마트폰의 "경보 해제" 버튼)
        if (entry.active_alert === null && entry.dismissed_at) {
          console.log("[Laptop] 전체 경보 해제 신호 수신");
          stopAlarmSound();
          clearAlertState();
        }
      }
    }
  })
  .subscribe();
```

---

## 2. 원격 해제 시 스마트폰이 전송하는 데이터

스마트폰에서 "🔇 컴퓨터 경보음 해제" 버튼을 누르면:

```json
{
  "active_alert": null,
  "dismissed_at": "2026-02-12T19:27:58.512Z",
  "remote_alarm_off": true
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `remote_alarm_off` | `boolean` | `true`이면 컴퓨터의 경보음만 즉시 해제 |
| `active_alert` | `null` | 경보 상태 해제됨을 의미 |
| `dismissed_at` | `string (ISO 8601)` | 해제 시각 |

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
  // 경보 UI 초기 상태로 복원
  console.log("[Laptop] 경보 상태가 초기화되었습니다.");
}
```

---

## 4. PIN 필요 여부 확인 (로컬 해제 시)

`devices.metadata.require_pc_pin` 값에 따라 **노트북에서 직접 경보를 해제할 때**만 PIN을 요구합니다.

```javascript
const { data: device } = await supabase
  .from('devices')
  .select('metadata')
  .eq('id', DEVICE_ID)
  .single();

const requirePcPin = device?.metadata?.require_pc_pin ?? false;
const alarmPin = device?.metadata?.alarm_pin ?? "0000";

function handleLocalDismiss() {
  if (requirePcPin) {
    showPinPad(alarmPin);  // PIN 입력 UI 표시
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
channel.track({ active_alert: { id, type, title, message, created_at } })
  ↓
스마트폰 useAlerts Presence sync → activeAlert 상태 업데이트
  ↓
스마트폰 UI에 경보 모드 + "🔇 컴퓨터 경보음 해제" 버튼 표시

[원격 해제 흐름]
스마트폰 "🔇 컴퓨터 경보음 해제" 버튼 클릭
  ↓
channel.track({ remote_alarm_off: true, active_alert: null, dismissed_at: ... })
  ↓
노트북 앱 Presence sync 이벤트 감지
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

1. **노트북은 경보 발생 시 반드시 `active_alert`를 Presence로 전송**해야 합니다. 이것이 없으면 스마트폰이 경보를 감지할 수 없습니다.
2. **원격 해제(`remote_alarm_off`)는 항상 PIN 없이 즉시 실행**해야 합니다.
3. **로컬 해제는 `require_pc_pin` 설정에 따라** PIN 입력을 요구할 수 있습니다.
4. Presence 채널은 앱 시작 시 구독하고, 앱 종료 시 해제해야 합니다.
5. 네트워크 끊김 시 자동 재연결 로직을 포함해야 합니다.
6. `active_alert.id`는 경보마다 고유해야 스마트폰에서 중복 경보음 재생을 방지할 수 있습니다.
