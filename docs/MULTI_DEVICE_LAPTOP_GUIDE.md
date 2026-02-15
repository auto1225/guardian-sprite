# 🖥️ MeerCOP 노트북(Broadcaster) 앱 - 다중 기기 지원 작업 가이드

## 📋 개요
스마트폰 앱이 다중 기기를 지원하도록 업데이트되었습니다.  
노트북(Broadcaster) 앱에서도 아래 사항을 확인/수정해야 합니다.

---

## ✅ 필수 작업 목록

### 1. 시리얼 넘버 기반 기기 등록 (validate-serial)
- **현재 상태**: `validate-serial` Edge Function이 시리얼로 기기를 등록하고 `licenses.device_id`에 매핑함
- **확인 사항**: 노트북 앱이 시작 시 `validate-serial`을 호출하여 자신의 `device_id`와 `user_id`를 받아오는지 확인
- **중요**: 각 컴퓨터는 **고유한 시리얼 넘버**를 사용해야 함 (1기기 = 1시리얼)

### 2. 경보 채널 구독 (device-alerts-${deviceId})
- **현재 상태**: 각 노트북은 `device-alerts-${자기device_id}` 채널에서 경보를 broadcast
- **확인 사항**: 
  - 채널 이름에 자기 `device_id`를 올바르게 사용하는지 확인
  - Presence `track()`에 `active_alert` 정보를 포함하는지 확인
  - 스마트폰이 `remote_alarm_off` broadcast를 수신하면 경보를 해제하는지 확인

### 3. Presence 채널 (device-presence-${deviceId})
- **현재 상태**: 각 기기는 고유한 Presence 채널로 온/오프라인 상태를 보고함
- **확인 사항**: 
  - `status`, `is_network_connected`, `is_camera_connected`, `last_seen_at` 필드를 track하는지 확인
  - 기기 연결/해제 시 즉시 Presence를 업데이트하는지 확인

### 4. 기기 상태 업데이트 (devices 테이블)
- **현재 상태**: `validate-serial` 호출 시 기기의 `name`, `device_type`이 DB에 동기화됨
- **확인 사항**: 
  - 노트북 앱에서 기기 이름/타입을 `validate-serial`에 전달하는지 확인
  - 주기적으로 `last_seen_at`을 업데이트하는지 확인 (heartbeat)

### 5. 센서 설정 수신 (devices.metadata)
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
Presence 채널 구독: device-presence-${device_id}
    ↓ → track({ status: 'online', is_network_connected, is_camera_connected, last_seen_at })
    ↓
경보 채널 구독: device-alerts-${device_id}
    ↓ → 경보 발생 시 broadcast + Presence track({ active_alert: {...} })
    ↓
스마트폰에서 remote_alarm_off 수신 → 경보 해제
```

---

## ⚠️ 주의사항
1. **채널 이름에 device_id 사용**: 모든 채널 이름은 반드시 `device_id`를 포함해야 함
2. **시리얼 재사용 금지**: 하나의 시리얼은 하나의 기기에만 연결됨
3. **RLS 제약**: 노트북 앱은 Supabase Auth 세션이 없으므로, DB 변경은 반드시 Edge Function을 통해 수행
4. **metadata 실시간 동기화**: 스마트폰에서 설정 변경 시 Realtime으로 즉시 반영되어야 함
