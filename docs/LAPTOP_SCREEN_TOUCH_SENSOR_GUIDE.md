# 노트북 앱 수정 가이드: 화면 터치 감지 센서 & 스마트폰 기기타입 추가

## 변경 사항 요약

### 1. `SensorSettings` 타입 변경
```typescript
// 기존
interface SensorSettings {
  deviceType: "laptop" | "desktop" | "tablet";
  // ...
}

// 변경 후
interface SensorSettings {
  deviceType: "laptop" | "desktop" | "tablet" | "smartphone";
  // ...
  screenTouch: boolean;  // ← 새로 추가
}
```

### 2. 화면 터치 감지 센서 (`screenTouch`) 구현

노트북 앱에서 `metadata.sensorSettings.screenTouch`가 `true`일 때 **터치스크린 이벤트를 감시**해야 합니다.

#### 감지 방법
```typescript
// 터치 이벤트 리스너 등록
const handleTouch = (e: TouchEvent) => {
  if (!sensorSettings.screenTouch) return;
  // 경보 트리거
  triggerAlert("screen_touch", "Screen touch detected");
};

document.addEventListener("touchstart", handleTouch, { passive: true });
document.addEventListener("touchend", handleTouch, { passive: true });
```

#### 경보 이벤트 키
- `alertEvents.screen_touch` — 새로운 경보 이벤트 타입
- 스마트폰 앱의 `alertEvents` 네임스페이스에도 해당 키 추가 필요

### 3. 기기타입에 `smartphone` 추가

스마트폰 앱 설정에서 기기 타입을 `smartphone`으로 설정할 수 있게 되었습니다.
- 노트북 앱에서는 이 값을 수신하여 적절히 처리해야 합니다
- `device_type` 필드가 `smartphone`일 수 있으므로 타입 가드에 추가 필요

### 4. 덮개 감지 (lidClosed) 제한

- `deviceType`이 `laptop`이 아닌 경우 `lidClosed` 센서는 자동으로 `false`로 설정됩니다
- 노트북 앱에서도 `sensorSettings.deviceType !== "laptop"`이면 lid 감지를 비활성화해야 합니다

### 5. 센서 키 매핑 업데이트

기존 센서 키 매핑에 다음을 추가하세요:

```typescript
const sensorKeyMap = {
  // 기존...
  camera: "cameraMotion",
  keyboard: "keyboard",
  mouse: "mouse",
  lidClosed: "lid",
  usb: "usb",
  power: "power",
  // 새로 추가
  screenTouch: "screenTouch",
};
```

### 6. `settings_updated` 브로드캐스트 처리

스마트폰에서 설정 변경 시 `device-commands-{deviceId}` 채널로 `settings_updated` 이벤트가 전송됩니다.
payload에 `sensorSettings` 객체가 포함되며, `screenTouch` 필드를 확인하여 리스너를 동적으로 등록/해제해야 합니다.

### 7. i18n 키 추가

노트북 앱의 번역 파일에 다음 키를 추가하세요:

```json
{
  "alertEvents": {
    "screen_touch": "화면 터치 감지"
  },
  "settings": {
    "smartphone": "스마트폰",
    "screenTouchDetection": "화면 터치 감지",
    "screenTouchDetectionDesc": "화면 터치 입력을 감지합니다",
    "lidNotSupported": "지원하지 않음",
    "lidNotSupportedDesc": "덮개 감지는 노트북에서만 사용할 수 있습니다."
  }
}
```

### 8. 기기타입 DB 저장 방식

기기타입(`deviceType`)은 `devices.metadata.sensorSettings.deviceType`에 저장되며, 동시에 `devices.device_type` 컬럼에도 동기화됩니다.
사용자가 수동으로 변경하기 전까지는 값이 유지됩니다. 노트북 앱에서 임의로 `device_type`을 변경하면 안 됩니다.

### 9. Capability 연동 (CMS 기반 기능 제한)

CMS의 `plan_features` 테이블에 `sensor_touch` 키가 추가되었습니다.

- **Capability 키**: `sensor_touch` (Boolean)
- **Free 플랜**: `false` (비활성)
- **Basic 플랜**: `true` (활성)
- **Premium 플랜**: `true` (활성)

노트북 앱에서는 스마트폰 앱이 전달하는 `sensorSettings.screenTouch` 값을 그대로 사용하면 됩니다.
플랜별 기능 제한(gating)은 스마트폰 앱 측에서 처리하므로, 노트북 앱은 별도의 capability 체크가 필요 없습니다.

### 10. 구현 체크리스트

- [ ] `SensorSettings` 타입에 `screenTouch: boolean` 추가
- [ ] `deviceType`에 `"smartphone"` 추가
- [ ] `touchstart` / `touchend` 이벤트 리스너 구현
- [ ] `screenTouch` 설정 변경 시 리스너 동적 등록/해제
- [ ] `screen_touch` 경보 이벤트 타입 추가
- [ ] `deviceType !== "laptop"`일 때 lid 감지 비활성화
- [ ] i18n 키 추가 (17개 언어)
- [ ] `settings_updated` 브로드캐스트에서 `screenTouch` 필드 처리
- [ ] 기기타입 변경 시 `device_type` 컬럼 동기화 확인 (노트북에서 임의 변경 금지)
