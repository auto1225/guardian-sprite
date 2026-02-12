# 원격 경보 해제 - 노트북 앱 구현 가이드

## 개요

스마트폰 앱에서 "🔇 컴퓨터 경보음 해제" 버튼을 누르면, Supabase Presence 채널을 통해 노트북에 경보 해제 신호가 전송됩니다. 노트북 앱은 이 신호를 실시간으로 감지하여 경보음을 즉시 중단해야 합니다.

---

## 1. Presence 채널 구독

노트북 앱은 자신의 `device_id`를 기반으로 Presence 채널을 구독해야 합니다.

```javascript
const DEVICE_ID = "your-device-id-here";
const channel = supabase.channel(`device-alerts-${DEVICE_ID}`);
```

## 2. 원격 해제 신호 감지

스마트폰이 경보 해제 버튼을 누르면 다음과 같은 Presence 상태가 전송됩니다:

```json
{
  "active_alert": null,
  "dismissed_at": "2026-02-12T19:27:58.512Z",
  "remote_alarm_off": true
}
```

### 핵심 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `remote_alarm_off` | `boolean` | `true`이면 컴퓨터의 경보음만 즉시 해제 |
| `active_alert` | `null` | 경보 상태 해제됨을 의미 |
| `dismissed_at` | `string (ISO 8601)` | 해제 시각 |

## 3. 노트북 앱 구현 코드

```javascript
// Presence 채널 구독 및 원격 해제 감지
const channel = supabase.channel(`device-alerts-${DEVICE_ID}`);

channel
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    
    // 모든 Presence 항목을 순회하며 remote_alarm_off 신호 확인
    for (const key of Object.keys(state)) {
      const entries = state[key];
      for (const entry of entries) {
        // ✅ 핵심: remote_alarm_off가 true이면 경보음 즉시 중단
        if (entry.remote_alarm_off === true) {
          console.log("[Laptop] 원격 경보 해제 신호 수신:", entry.dismissed_at);
          stopAlarmSound();  // 경보음 중단 함수 호출
          
          // active_alert가 null이면 전체 경보 상태도 해제
          if (entry.active_alert === null) {
            clearAlertState();  // 경보 UI 해제
          }
        }
        
        // active_alert가 null이고 dismissed_at가 있으면 일반 경보 해제
        if (entry.active_alert === null && entry.dismissed_at) {
          console.log("[Laptop] 경보 해제 신호 수신");
          stopAlarmSound();
          clearAlertState();
        }
      }
    }
  })
  .subscribe();
```

## 4. 경보음 중단 함수 예시

```javascript
let alarmAudioContext = null;
let alarmInterval = null;

function stopAlarmSound() {
  // AudioContext 기반 경보음 중단
  if (alarmAudioContext) {
    alarmAudioContext.close();
    alarmAudioContext = null;
  }
  
  // 반복 재생 타이머 중단
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  
  // HTML Audio 요소 사용 시
  const audioElement = document.getElementById('alarm-audio');
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
  }
  
  console.log("[Laptop] 경보음이 해제되었습니다.");
}

function clearAlertState() {
  // 경보 관련 UI를 초기 상태로 복원
  // - 경보 오버레이 닫기
  // - 경보 상태 플래그 초기화
  // - 필요 시 위장 모드 해제
  console.log("[Laptop] 경보 상태가 초기화되었습니다.");
}
```

## 5. PIN 필요 여부 확인 (로컬 해제 시)

스마트폰 설정에서 `require_pc_pin`을 설정할 수 있습니다. 이 값은 `devices.metadata`에 저장되며, **노트북에서 직접 경보를 해제할 때**만 적용됩니다.

```javascript
// devices.metadata에서 PIN 필요 여부 확인
const { data: device } = await supabase
  .from('devices')
  .select('metadata')
  .eq('id', DEVICE_ID)
  .single();

const requirePcPin = device?.metadata?.require_pc_pin ?? false;
const alarmPin = device?.metadata?.alarm_pin ?? "0000";

// 노트북에서 직접 경보 해제 시
function handleLocalDismiss() {
  if (requirePcPin) {
    // PIN 입력 UI 표시
    showPinPad(alarmPin);
  } else {
    // PIN 없이 바로 해제
    stopAlarmSound();
    clearAlertState();
  }
}
```

> ⚠️ **중요**: `remote_alarm_off: true` 신호로 수신된 원격 해제는 PIN 확인 없이 **즉시** 경보음을 중단해야 합니다. PIN 확인은 노트북에서 직접(로컬) 해제할 때만 적용됩니다.

## 6. 전체 흐름 요약

```
스마트폰 "🔇 컴퓨터 경보음 해제" 버튼 클릭
  ↓
Presence channel track({ remote_alarm_off: true, active_alert: null, dismissed_at: ... })
  ↓
노트북 앱 Presence sync 이벤트 감지
  ↓
remote_alarm_off === true 확인
  ↓
stopAlarmSound() 즉시 호출 (PIN 불필요)
  ↓
경보음 중단 완료
```

## 7. metadata 내 관련 설정 필드

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `require_pc_pin` | `boolean` | `false` | 노트북 로컬 경보 해제 시 PIN 필요 여부 |
| `alarm_pin` | `string` | `"0000"` | 경보 해제 PIN (4자리) |
| `alarm_sound_id` | `string` | `"default"` | 사용할 경보음 ID |

---

## 주의사항

1. **원격 해제(remote_alarm_off)는 항상 PIN 없이 즉시 실행**해야 합니다.
2. **로컬 해제는 `require_pc_pin` 설정에 따라** PIN 입력을 요구할 수 있습니다.
3. Presence 채널은 앱 시작 시 구독하고, 앱 종료 시 해제해야 합니다.
4. 네트워크 끊김 시 자동 재연결 로직을 포함해야 합니다.
