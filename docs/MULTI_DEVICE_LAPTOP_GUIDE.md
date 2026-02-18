# 🖥️ MeerCOP 노트북(Broadcaster) 앱 - 다중 기기 지원 작업 가이드

## 📋 개요
스마트폰 앱이 다중 기기를 지원하도록 업데이트되었습니다.  
노트북(Broadcaster) 앱에서도 아래 사항을 확인/수정해야 합니다.

> ⚠️ **채널 아키텍처 변경 (2026-02)**: 기기별 채널(`device-*-${deviceId}`)에서 **사용자별 채널(`user-*-${userId}`)** 로 전환되었습니다. 기기 구분은 Presence `key` 또는 페이로드의 `device_id` 필드로 수행합니다.

---

## ✅ 필수 작업 목록

### 1. 시리얼 넘버 기반 기기 등록 (validate-serial)
- **현재 상태**: `validate-serial` Edge Function이 시리얼로 기기를 등록하고 `licenses.device_id`에 매핑함
- **확인 사항**: 노트북 앱이 시작 시 `validate-serial`을 호출하여 자신의 `device_id`와 `user_id`를 받아오는지 확인
- **중요**: 각 컴퓨터는 **고유한 시리얼 넘버**를 사용해야 함 (1기기 = 1시리얼)

### 2. 경보 채널 구독 — `user-alerts-${userId}`
- **⚠️ 변경됨**: 이전 `device-alerts-${deviceId}` → 현재 `user-alerts-${userId}`
- **확인 사항**: 
  - 채널 이름에 `userId`를 사용하고, 모든 페이로드에 `device_id`를 포함하는지 확인
  - Presence `track()`에 `key: deviceId`로 기기를 식별하고, `active_alert` 정보를 포함하는지 확인
  - 스마트폰이 `remote_alarm_off` broadcast를 수신하면 경보를 해제하는지 확인

### 3. Presence 채널 — `user-presence-${userId}`
- **⚠️ 변경됨**: 이전 `device-presence-${deviceId}` → 현재 `user-presence-${userId}`
- **확인 사항**: 
  - `key: deviceId`로 track하여 기기를 구분
  - `status`, `is_network_connected`, `is_camera_connected`, `battery_level`, `last_seen_at` 필드를 track하는지 확인
  - 기기 연결/해제 시 즉시 Presence를 업데이트하는지 확인

### 4. 명령 채널 — `device-commands-${deviceId}`
- **유지됨**: 이 채널은 기기별로 유지 (개별 기기에 명령을 보내므로)
- **수신해야 할 이벤트**:
  | 이벤트 | 페이로드 | 설명 |
  |--------|----------|------|
  | `monitoring_toggle` | `{ device_id, is_monitoring }` | 감시 온/오프 |
  | `camouflage_toggle` | `{ device_id, camouflage_mode }` | 위장 모드 온/오프 |
  | `lock_command` | `{ device_id, timestamp }` | 화면 잠금 |
  | `message_command` | `{ device_id, message, timestamp }` | 팝업 메시지 표시 |

### 5. 기기 상태 업데이트 (devices 테이블)
- **현재 상태**: `validate-serial` 호출 시 기기의 `name`, `device_type`이 DB에 동기화됨
- **확인 사항**: 
  - 노트북 앱에서 기기 이름/타입을 `validate-serial`에 전달하는지 확인
  - 주기적으로 `last_seen_at`을 업데이트하는지 확인 (heartbeat, 60초 주기)

### 6. 배터리 잔량 동기화
- **신규**: Presence track 시 `battery_level` (0~100 정수)을 포함
- 스마트폰 앱이 Presence sync에서 `battery_level`을 읽어 UI에 표시

### 7. 센서 설정 수신 (devices.metadata)
- **현재 상태**: 스마트폰에서 설정한 센서 옵션이 `devices.metadata`에 저장됨
- **확인 사항**: 
  - Realtime으로 `metadata` 변경을 감지하고 센서 설정을 동적으로 반영하는지 확인
  - 주요 설정 필드:
    ```json
    {
      "sensorSettings": {
        "deviceType": "laptop|desktop|tablet",
        "lidClosed": true/false,
        "camera": true/false,
        "microphone": true/false,
        "keyboard": true/false,
        "keyboardType": "wired|wireless",
        "mouse": true/false,
        "mouseType": "wired|wireless",
        "usb": true/false,
        "power": true/false
      },
      "alarm_pin": "1234",
      "alarm_sound_id": "whistle",
      "require_pc_pin": true/false,
      "motionSensitivity": "sensitive|normal|insensitive",
      "mouseSensitivity": "sensitive|normal|insensitive",
      "camouflage_mode": true/false
    }
    ```

---

## 🔑 시리얼 넘버 정보

| 기기 이름 | 시리얼 넘버 | Device ID |
|-----------|-------------|-----------|
| minho com | `HKXQ-XG7W-54NY` | `3d9b2272-b398-400f-9624-0e2c924deab1` |
| minho com2 | `5G7Z-NH53-SPCN` | `843adc55-9d7f-4dd3-9b3e-2a2834ae3f19` |

---

## 🔄 데이터 흐름 요약

```
[노트북 앱 시작]
    ↓
validate-serial(serial_key, device_name, device_type)
    ↓ → device_id, user_id 수신
    ↓
Presence 채널 구독: user-presence-${user_id}
    ↓ → track({ status: 'online', is_network_connected, is_camera_connected, battery_level, last_seen_at }, key: device_id)
    ↓
경보 채널 구독: user-alerts-${user_id}
    ↓ → 경보 발생 시 track({ active_alert: {...} }, key: device_id)
    ↓
명령 채널 구독: device-commands-${device_id}
    ↓ → monitoring_toggle, camouflage_toggle, lock_command, message_command 수신
    ↓
스마트폰에서 remote_alarm_off 수신 → 경보 해제
```

---

## 📡 채널 구조 요약

| 채널 이름 | 구분 방식 | 용도 |
|-----------|-----------|------|
| `user-presence-${userId}` | `key: deviceId` | 기기 온/오프라인, 배터리 등 상태 |
| `user-alerts-${userId}` | 페이로드 `device_id` | 경보 발생/해제 |
| `user-photos-${userId}` | 페이로드 `device_id` | 사진 경보 전송 |
| `device-commands-${deviceId}` | 기기별 채널 | 개별 기기 명령 수신 |

---

## ⚠️ 주의사항
1. **사용자별 채널 사용**: Presence/Alert 채널은 `userId`를 사용하고, `key` 또는 `device_id` 필드로 기기를 구분
2. **명령 채널만 기기별**: `device-commands-${deviceId}`만 기기별 채널 유지
3. **시리얼 재사용 금지**: 하나의 시리얼은 하나의 기기에만 연결됨
4. **RLS 제약**: 노트북 앱은 Supabase Auth 세션이 없으므로, DB 변경은 반드시 Edge Function을 통해 수행
5. **metadata 실시간 동기화**: 스마트폰에서 설정 변경 시 Realtime으로 즉시 반영되어야 함
6. **배터리 정보 전송**: Presence track 시 `battery_level` 포함 필수
