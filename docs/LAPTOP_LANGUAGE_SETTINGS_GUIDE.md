# 노트북 앱 언어 설정 연동 가이드

## 개요

스마트폰 앱에서 선택한 언어가 노트북 앱에도 동일하게 적용되어야 합니다.
스마트폰 앱은 17개 언어를 지원하며, AI 기반 자동 번역 시스템을 사용합니다.

---

## 1. 지원 언어 목록

| # | 코드 | 언어 | 국기 |
|---|------|------|------|
| 1 | `ko` | 한국어 | 🇰🇷 |
| 2 | `en` | English | 🇺🇸 |
| 3 | `ja` | 日本語 | 🇯🇵 |
| 4 | `zh-CN` | 简体中文 | 🇨🇳 |
| 5 | `zh-TW` | 繁體中文 | 🇹🇼 |
| 6 | `es` | Español | 🇪🇸 |
| 7 | `fr` | Français | 🇫🇷 |
| 8 | `de` | Deutsch | 🇩🇪 |
| 9 | `pt` | Português | 🇧🇷 |
| 10 | `ru` | Русский | 🇷🇺 |
| 11 | `ar` | العربية | 🇸🇦 |
| 12 | `hi` | हिन्दी | 🇮🇳 |
| 13 | `th` | ไทย | 🇹🇭 |
| 14 | `vi` | Tiếng Việt | 🇻🇳 |
| 15 | `id` | Bahasa Indonesia | 🇮🇩 |
| 16 | `tr` | Türkçe | 🇹🇷 |
| 17 | `it` | Italiano | 🇮🇹 |

---

## 2. 언어 수신 방법

### 2-1. 브로드캐스트 수신 (실시간)

스마트폰에서 언어 변경 시 `settings_updated` 브로드캐스트가 전송됩니다.

```typescript
// 채널: device-commands-{deviceId}
// 이벤트: settings_updated
// 페이로드 예시:
{
  device_id: "uuid-here",
  settings: {
    language: "ja"  // 변경된 언어 코드
    // 다른 설정도 함께 올 수 있음
  }
}
```

**수신 코드 예시:**
```typescript
const channel = supabase.channel(`device-commands-${deviceId}`);
channel.on("broadcast", { event: "settings_updated" }, (payload) => {
  const lang = payload.payload?.settings?.language;
  if (lang) {
    applyLanguage(lang); // 언어 변경 적용
  }
});
channel.subscribe();
```

### 2-2. DB에서 읽기 (앱 시작 시)

```typescript
const { data } = await supabase
  .from("devices")
  .select("metadata")
  .eq("id", deviceId)
  .single();

const lang = data?.metadata?.language || "ko"; // 기본값: 한국어
applyLanguage(lang);
```

---

## 3. 번역 시스템 구현

### 3-1. 정적 번역 (17개 언어 전체)

**모든 17개 언어가 JSON 파일로 정적 번들됩니다.** Edge Function 호출이 필요 없습니다.

```
src/i18n/locales/ko.json     ← 한국어 (기준 파일)
src/i18n/locales/en.json     ← English
src/i18n/locales/ja.json     ← 日本語
src/i18n/locales/zh-CN.json  ← 简体中文
src/i18n/locales/zh-TW.json  ← 繁體中文
src/i18n/locales/es.json     ← Español
src/i18n/locales/fr.json     ← Français
src/i18n/locales/de.json     ← Deutsch
src/i18n/locales/pt.json     ← Português
src/i18n/locales/ru.json     ← Русский
src/i18n/locales/ar.json     ← العربية
src/i18n/locales/hi.json     ← हिन्दी
src/i18n/locales/th.json     ← ไทย
src/i18n/locales/vi.json     ← Tiếng Việt
src/i18n/locales/id.json     ← Bahasa Indonesia
src/i18n/locales/tr.json     ← Türkçe
src/i18n/locales/it.json     ← Italiano
```

### 3-2. i18next 설정

모든 언어를 `import`로 불러와서 `resources`에 등록합니다.

```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ko from "./locales/ko.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";
import hi from "./locales/hi.json";
import th from "./locales/th.json";
import vi from "./locales/vi.json";
import id from "./locales/id.json";
import tr from "./locales/tr.json";
import it from "./locales/it.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      ja: { translation: ja },
      "zh-CN": { translation: zhCN },
      "zh-TW": { translation: zhTW },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      pt: { translation: pt },
      ru: { translation: ru },
      ar: { translation: ar },
      hi: { translation: hi },
      th: { translation: th },
      vi: { translation: vi },
      id: { translation: id },
      tr: { translation: tr },
      it: { translation: it },
    },
    fallbackLng: "ko",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "meercop_language",
    },
  });
```

### 3-3. 언어 변경 함수

동적 번역이 불필요하므로 `i18n.changeLanguage()`만 호출하면 됩니다.

```typescript
async function applyLanguage(lang: string) {
  await i18n.changeLanguage(lang);
  
  // RTL 처리
  const isRTL = lang === "ar";
  document.documentElement.dir = isRTL ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}
```

> ⚠️ **더 이상 `translate-i18n` Edge Function 호출이나 localStorage 캐시가 필요 없습니다.**  
> 새 번역 키를 추가할 경우 `ko.json`을 수정한 후 나머지 16개 JSON 파일도 함께 업데이트하세요.

---

## 4. 노트북 전용 번역 키

노트북 앱에만 필요한 키는 `laptop.*` 네임스페이스에 추가합니다.  
이 키들은 ko.json, en.json에 직접 작성하고, AI 번역 시 함께 번역됩니다.

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
      "stopped": "감시가 중지되었습니다"
    },
    "serial": {
      "enterSerial": "시리얼 넘버를 입력하세요",
      "invalidSerial": "유효하지 않은 시리얼입니다",
      "registered": "기기가 등록되었습니다"
    }
  }
}
```

---

## 5. UI/UX 디자인 가이드

### 5-1. 노트북 앱에서는 언어 설정 UI 불필요

- 언어 변경은 **스마트폰 앱에서만** 수행합니다.
- 노트북 앱은 수신한 언어를 자동 적용만 하면 됩니다.
- 노트북 앱에 별도 언어 선택 UI를 만들지 마세요.

### 5-2. 언어 변경 시 UI 전환 동작

```
[스마트폰에서 언어 변경]
        ↓
[broadcast 수신]
        ↓
[로딩 표시] ← 번역 로드 중 토스트 또는 스피너 (1~3초)
        ↓
[UI 전체 갱신] ← 모든 텍스트가 새 언어로 변경
```

**로딩 중 표시 (권장):**
```typescript
// 언어 변경 시 짧은 토스트 표시
toast({
  title: "🌐",
  description: `${langLabel}...`, // 예: "日本語..."
  duration: 2000
});
```

### 5-3. RTL (Right-to-Left) 지원

아랍어(`ar`) 선택 시 텍스트 방향을 RTL로 변경해야 합니다.

```typescript
function applyLanguage(lang: string) {
  i18n.changeLanguage(lang);
  
  // RTL 처리
  const isRTL = lang === "ar";
  document.documentElement.dir = isRTL ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}
```

**CSS RTL 대응:**
```css
/* RTL 모드에서 레이아웃 반전 */
[dir="rtl"] .flex-row {
  flex-direction: row-reverse;
}

[dir="rtl"] .text-left {
  text-align: right;
}

/* 또는 Tailwind CSS 사용 시 */
/* rtl: 접두사 활용 */
```

### 5-4. 경보 화면 다국어

경보 화면은 가장 중요한 화면이므로 반드시 번역이 적용되어야 합니다.

```
┌─────────────────────────────┐
│                             │
│      ⚠️ 警報が発生しました     │  ← laptop.alarmScreen.title
│                             │
│   パスワードを入力してください   │  ← laptop.alarmScreen.enterPin
│                             │
│      ┌─────────────────┐    │
│      │  ● ● ● ●        │    │  ← PIN 입력
│      └─────────────────┘    │
│                             │
└─────────────────────────────┘
```

### 5-5. 잠금 화면 다국어

```
┌─────────────────────────────┐
│                             │
│     🔒 画面がロックされました   │  ← laptop.lockScreen.title
│                             │
│      リモートでロックされました  │  ← laptop.lockScreen.lockedBy
│                             │
│  ロック解除は管理者にお問い合わせ │  ← laptop.lockScreen.unlockPrompt
│     ください                  │
│                             │
└─────────────────────────────┘
```

### 5-6. 메시지 팝업 다국어

```
┌─────────────────────────────┐
│  📩 リモートメッセージ         │  ← laptop.messagePopup.title
│  ─────────────────────────  │
│                             │
│  "자리 비워주세요"             │  ← 사용자 입력 메시지 (번역 X)
│                             │
│  管理者から                   │  ← laptop.messagePopup.from
│              [ OK ]         │
└─────────────────────────────┘
```

> ⚠️ 사용자가 입력한 메시지 본문은 번역하지 않습니다. UI 프레임만 번역합니다.

### 5-7. 시리얼 입력 화면 다국어

```
┌─────────────────────────────┐
│                             │
│  MeerCOP                    │
│                             │
│  シリアルナンバーを入力して     │  ← laptop.serial.enterSerial
│  ください                    │
│                             │
│  ┌─────────────────────┐    │
│  │ XXXX-XXXX-XXXX      │    │
│  └─────────────────────┘    │
│                             │
│       [ 登録 ]              │  ← common.register
│                             │
└─────────────────────────────┘
```

---

## 6. 폰트 고려사항

일부 언어는 특수 폰트가 필요할 수 있습니다:

| 언어 | 권장 폰트 | 비고 |
|------|-----------|------|
| `ko` | Pretendard, Noto Sans KR | 기본 |
| `ja` | Noto Sans JP | 일본어 한자 |
| `zh-CN` | Noto Sans SC | 간체 중국어 |
| `zh-TW` | Noto Sans TC | 번체 중국어 |
| `ar` | Noto Sans Arabic | RTL + 연결 문자 |
| `hi` | Noto Sans Devanagari | 힌디어 |
| `th` | Noto Sans Thai | 태국어 성조 부호 |

**웹 폰트 로딩 (권장):**
```css
/* Google Fonts에서 필요한 언어별 폰트만 로드 */
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP&family=Noto+Sans+SC&family=Noto+Sans+TC&family=Noto+Sans+Arabic&display=swap');

body {
  font-family: 'Pretendard', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 
               'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans Thai', 
               system-ui, sans-serif;
}
```

> 💡 시스템 폰트로 대부분 커버되므로, 웹 폰트는 표시가 깨지는 경우에만 추가하세요.

---

## 7. 구현 체크리스트

- [ ] `settings_updated` 브로드캐스트에서 `language` 키 수신 처리
- [ ] 앱 시작 시 `devices.metadata.language` 읽어서 초기 언어 설정
- [ ] 17개 정적 번역 JSON 파일 전체 import 및 i18next 등록
- [ ] `i18n.changeLanguage(lang)` 호출로 즉시 언어 전환 (Edge Function 불필요)
- [ ] 아랍어 RTL 레이아웃 대응
- [ ] 경보 화면 다국어 적용
- [ ] 잠금 화면 다국어 적용
- [ ] 메시지 팝업 다국어 적용
- [ ] 시리얼 입력 화면 다국어 적용
- [ ] 필요 시 특수 언어 폰트 로드
