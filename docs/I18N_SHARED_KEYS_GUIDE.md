# i18n Shared Keys Guide (스마트폰 ↔ 노트북 앱)

## 공유 번역 키 구조

양쪽 앱이 동일한 키를 사용하여 일관된 용어를 유지합니다.
노트북 앱에서도 동일한 `i18next` 설정과 JSON 구조를 사용하세요.

## 공통 키 (Common Keys)

아래 키들은 양쪽 앱에서 동일하게 사용됩니다:

### `common.*`
| Key | KO | EN |
|-----|-----|-----|
| `common.loading` | 로딩 중... | Loading... |
| `common.error` | 오류 | Error |
| `common.save` | 저장 | Save |
| `common.cancel` | 취소 | Cancel |
| `common.confirm` | 확인 | Confirm |
| `common.close` | 닫기 | Close |
| `common.online` | 온라인 | Online |
| `common.offline` | 오프라인 | Offline |
| `common.on` | ON | ON |
| `common.off` | OFF | OFF |

### `alertEvents.*` (경보 이벤트 라벨)
| Key | KO | EN |
|-----|-----|-----|
| `alertEvents.camera_motion` | 카메라 움직임 감지 | Camera motion detected |
| `alertEvents.keyboard` | 키보드 입력 감지 | Keyboard input detected |
| `alertEvents.mouse` | 마우스 입력 감지 | Mouse input detected |
| `alertEvents.lid` | 덮개 열림 감지 | Lid opened |
| `alertEvents.power` | 전원 변경 감지 | Power change detected |

### `commands.*` (원격 명령)
| Key | KO | EN |
|-----|-----|-----|
| `commands.lockTitle` | 화면 잠금 | Lock Screen |
| `commands.messageTitle` | 메시지 전송 | Send Message |

### `settings.sensitivity.*` (센서 민감도)
| Key | KO | EN |
|-----|-----|-----|
| `settings.sensitivity.sensitive` | 민감 | Sensitive |
| `settings.sensitivity.normal` | 보통 | Normal |
| `settings.sensitivity.insensitive` | 둔감 | Insensitive |

## 노트북 전용 키 (Laptop-Only Keys)

노트북 앱에서만 사용하는 키입니다. 스마트폰 앱의 JSON에는 포함되어 있지 않습니다.

```json
{
  "laptop": {
    "alarmScreen": {
      "title": "⚠️ 경보 발생",
      "enterPin": "비밀번호를 입력하세요",
      "wrongPin": "비밀번호가 틀렸습니다",
      "dismissed": "경보가 해제되었습니다"
    },
    "lockScreen": {
      "title": "화면이 잠겼습니다",
      "lockedBy": "원격으로 잠김",
      "unlockPrompt": "잠금을 해제하려면 관리자에게 문의하세요"
    },
    "messagePopup": {
      "title": "원격 메시지",
      "from": "관리자로부터"
    },
    "monitoring": {
      "started": "감시가 시작되었습니다",
      "stopped": "감시가 중지되었습니다",
      "sensorActive": "센서 활성화됨"
    },
    "serial": {
      "enterSerial": "시리얼 넘버를 입력하세요",
      "invalidSerial": "유효하지 않은 시리얼입니다",
      "registered": "기기가 등록되었습니다"
    }
  }
}
```

## 설정 방법

### 1. i18next 설정 (노트북 앱)

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ko from './locales/ko.json';
import en from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ko: { translation: ko }, en: { translation: en } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
```

### 2. 공통 키 동기화 방법

공통 키(`common`, `alertEvents`, `commands`, `settings.sensitivity`)는 
스마트폰 앱의 `src/i18n/locales/` 파일을 기준으로 동기화합니다.

노트북 앱의 JSON 파일에 공통 키를 복사한 후, 노트북 전용 키를 추가합니다.

### 3. 브로드캐스트 이벤트와 i18n 키 매핑

| 브로드캐스트 이벤트 | 노트북 표시 | i18n 키 |
|-----|-----|-----|
| `lock_command` | 화면 잠금 실행 | `laptop.lockScreen.title` |
| `message_command` | 메시지 팝업 표시 | `laptop.messagePopup.title` |
| `monitoring_toggle` | 감시 시작/중지 | `laptop.monitoring.started/stopped` |
| `camouflage_toggle` | 위장 모드 토글 | (화면 자체가 검은색으로 변경) |
