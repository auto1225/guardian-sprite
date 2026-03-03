# CMS plan_features 테이블 요구사항

## 개요
스마트폰 앱은 `verify-serial` Edge Function이 반환하는 `capabilities` JSONB 객체를 기반으로 기능을 제어합니다.
CMS의 `plan_features` 테이블에 아래 키들이 **모든 플랜(free, basic, premium)** 에 설정되어 있어야 합니다.

## 필수 Capability 키 목록

### Boolean 키 (true/false)

| 키 | 설명 | Free 권장 | Basic 권장 | Premium 권장 |
|---|---|---|---|---|
| `monitoring_toggle` | 감시 모드 ON/OFF | ✅ true | ✅ true | ✅ true |
| `camouflage_mode` | 위장 모드 (감시 중 화면 숨김) | ❌ false | ✅ true | ✅ true |
| `location_tracking` | 위치 지도 보기 | ❌ false | ✅ true | ✅ true |
| `network_info` | 네트워크 정보 보기 | ❌ false | ✅ true | ✅ true |
| `camera_view` | 카메라 뷰어 (스냅샷) | ❌ false | ✅ true | ✅ true |
| `alert_video_streaming` | 실시간 스트리밍 (WebRTC) | ❌ false | ❌ false | ✅ true |
| `alert_photo_capture` | 원격 사진 촬영 | ❌ false | ✅ true | ✅ true |
| `alert_history` | 알림 기록 보기 | ❌ false | ✅ true | ✅ true |
| `alert_location` | 알림 위치 보기 | ❌ false | ✅ true | ✅ true |
| `laptop_location_request` | 노트북 위치 요청 | ❌ false | ✅ true | ✅ true |
| `multi_device` | 다중 기기 관리 | ❌ false | ✅ true | ✅ true |
| `sensor_camera_motion` | 센서: 카메라 모션 감지 | ❌ false | ✅ true | ✅ true |
| `sensor_keyboard` | 센서: 키보드 감지 | ✅ true | ✅ true | ✅ true |
| `sensor_mouse` | 센서: 마우스 감지 | ❌ false | ✅ true | ✅ true |
| `sensor_usb` | 센서: USB 감지 | ❌ false | ✅ true | ✅ true |
| `sensor_power` | 센서: 전원 감지 | ❌ false | ❌ false | ✅ true |
| `sensor_lid` | 센서: 노트북 덮개 감지 | ❌ false | ❌ false | ✅ true |

### Number 키

| 키 | 설명 | Free 권장 | Basic 권장 | Premium 권장 |
|---|---|---|---|---|
| `max_devices` | 최대 등록 기기 수 | 1 | 3 | 10 |

## 주의사항

1. **누락된 키는 false/0으로 처리됩니다.** 허용하려는 기능은 반드시 명시적으로 `true`로 설정해야 합니다.
2. `capabilities`는 사용자의 **가장 높은 활성 플랜** 기준으로 병합(merge)되어야 합니다.
3. 앱은 `localStorage`에 capabilities를 캐싱하므로, CMS 변경 후 사용자가 재로그인하거나 앱을 새로고침해야 반영됩니다.
4. `verify-serial` 응답 형식:
```json
{
  "serials": [...],
  "capabilities": {
    "monitoring_toggle": true,
    "camouflage_mode": false,
    "max_devices": 3,
    ...
  }
}
```
