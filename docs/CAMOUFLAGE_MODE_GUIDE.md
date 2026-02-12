# 위장 모드 (Camouflage Mode) - 랩탑 앱 연동 가이드

## 개요
위장 모드는 노트북 화면을 검은 화면으로 덮어 모니터가 꺼진 것처럼 보이게 하는 기능입니다.
감시가 진행 중임을 숨기면서 백그라운드에서 모든 센서가 정상 작동합니다.

## 스마트폰 → 노트북 제어 흐름

```
스마트폰 앱 (이 프로젝트)
  → devices.metadata.camouflage_mode = true/false 업데이트
  → Supabase Realtime으로 변경 감지
  → 노트북 앱 (meercoplaptop)이 오버레이 ON/OFF
```

## 랩탑 앱 구현 사항

### 1. metadata 변경 구독

```typescript
// devices 테이블의 metadata 변경을 Realtime으로 감지
supabase
  .channel('camouflage-mode')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'devices',
    filter: `id=eq.${deviceId}`,
  }, (payload) => {
    const metadata = payload.new.metadata;
    if (metadata?.camouflage_mode) {
      activateCamouflage();
    } else {
      deactivateCamouflage();
    }
  })
  .subscribe();
```

### 2. 위장 오버레이 구현

> ⚠️ **중요**: 브라우저의 `requestFullscreen()`은 반드시 사용자 클릭 이벤트 내에서 호출해야 합니다.
> `useEffect`나 Realtime 콜백에서 직접 호출하면 `Permissions check failed` 에러가 발생합니다.
> **Electron/Tauri를 사용하는 경우 이 제한이 없으므로, Electron API를 사용하세요.**

#### 방법 A: Electron 사용 시 (권장 — 모니터 전체 덮기 가능)

Realtime 콜백에서 바로 전체화면 + 키오스크 진입이 가능합니다:

```typescript
// === Main Process (electron main.ts) ===
import { BrowserWindow, ipcMain } from 'electron';

let mainWindow: BrowserWindow;

ipcMain.on('camouflage:activate', () => {
  mainWindow.setFullScreen(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver'); // 최상위 레벨
  mainWindow.setKiosk(true);         // 태스크바까지 숨김
  mainWindow.setClosable(false);
  mainWindow.setMinimizable(false);
});

ipcMain.on('camouflage:deactivate', () => {
  mainWindow.setKiosk(false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setClosable(true);
  mainWindow.setMinimizable(true);
  mainWindow.setFullScreen(false);
});

// === Renderer Process (React 컴포넌트) ===
// Realtime 콜백에서 직접 호출 가능 (Electron은 브라우저 권한 제한 없음)
useEffect(() => {
  if (camouflageMode) {
    window.electron.ipcRenderer.send('camouflage:activate');
  } else {
    window.electron.ipcRenderer.send('camouflage:deactivate');
  }
}, [camouflageMode]);
```

#### 방법 B: 순수 웹 브라우저 사용 시 (제한적)

`requestFullscreen()`은 사용자 제스처 없이 호출 불가하므로, **검은 오버레이만** 표시합니다.
(앱 창 영역만 덮이며, 태스크바 등은 숨기지 못합니다)

```typescript
function activateCamouflage() {
  // requestFullscreen()은 호출하지 않음 — Realtime 콜백에서 불가
  const overlay = document.createElement('div');
  overlay.id = 'camouflage-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: #000000;
    cursor: none;
  `;
  overlay.tabIndex = 0;

  const blockEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu', 'wheel'].forEach(evt => {
    overlay.addEventListener(evt, blockEvent, true);
  });

  document.body.appendChild(overlay);
  overlay.focus();
}

function deactivateCamouflage() {
  const overlay = document.getElementById('camouflage-overlay');
  if (overlay) overlay.remove();
}
```

### 3. 중요 사항

- **해제는 스마트폰에서만 가능**: 랩탑의 키보드/마우스 입력을 모두 차단
- **감시 기능은 계속 동작**: 센서, 카메라, 네트워크 모니터링 정상 유지
- **Presence 유지**: 위장 모드에서도 Presence track()은 계속 동작해야 함
- **화면 보호기와 구별**: OS 화면 보호기 비활성화 권장 (혼동 방지)

## metadata 필드 구조

```json
{
  "camouflage_mode": true,    // boolean: 위장 모드 활성/비활성
  "sensorSettings": { ... },  // 기존 센서 설정
  "alarmPin": "..."            // 기존 알람 PIN
}
```
