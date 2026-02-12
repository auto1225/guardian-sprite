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

### 2. 위장 오버레이 구현 (Electron/Tauri)

```typescript
function activateCamouflage() {
  // 1. 전체화면(Fullscreen) 진입 — 모니터 전체를 덮음
  document.documentElement.requestFullscreen?.().catch(() => {});

  // 2. 검은 오버레이 생성
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
  
  // 모든 입력 이벤트 차단 (ESC 포함)
  const blockEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu', 'wheel'].forEach(evt => {
    overlay.addEventListener(evt, blockEvent, true);
  });

  // ESC로 전체화면 해제 방지
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.getElementById('camouflage-overlay')) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });
  
  document.body.appendChild(overlay);
  overlay.focus();
}

function deactivateCamouflage() {
  const overlay = document.getElementById('camouflage-overlay');
  if (overlay) overlay.remove();
  
  // 전체화면 해제
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}
```

### Electron/Tauri 추가 설정 (권장)

Electron의 경우 더 완벽한 전체화면 제어가 가능합니다:

```typescript
// Electron main process
const { BrowserWindow } = require('electron');

function activateCamouflageElectron(win: BrowserWindow) {
  win.setFullScreen(true);        // 모니터 전체 화면
  win.setAlwaysOnTop(true);       // 항상 최상위
  win.setClosable(false);         // 닫기 방지
  win.setKiosk(true);             // 키오스크 모드 (태스크바 숨김)
}

function deactivateCamouflageElectron(win: BrowserWindow) {
  win.setKiosk(false);
  win.setAlwaysOnTop(false);
  win.setClosable(true);
  win.setFullScreen(false);
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
