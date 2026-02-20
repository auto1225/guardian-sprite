# 노트북 앱 장시간 감시 안정화 가이드

## 개요

감시 모드가 24시간 이상 지속될 수 있으므로, 노트북 앱은 크래시/절전/네트워크 단절에 대한 복원력이 필수입니다.

---

## 1. 프로세스 자동 복구

### 1-1. 크래시 감지 + 자동 재시작

브라우저(Electron/PWA) 기반이므로 OS 레벨 프로세스 감시가 필요합니다.

**Electron 앱인 경우:**
```javascript
// main.js
const { app, BrowserWindow } = require('electron');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({ /* ... */ });
  mainWindow.loadURL('app-url');
  
  // 렌더러 크래시 시 자동 재시작
  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('[Stability] Renderer crashed, restarting...');
    setTimeout(() => {
      mainWindow.reload();
    }, 3000);
  });
  
  // 응답 없음 감지
  mainWindow.on('unresponsive', () => {
    console.error('[Stability] Window unresponsive, restarting...');
    mainWindow.reload();
  });
}

// 앱 크래시 시 자동 재시작
app.on('will-quit', (e) => {
  // 감시 중이었으면 재시작
  if (isMonitoringActive) {
    e.preventDefault();
    app.relaunch();
    app.exit(0);
  }
});
```

**PWA 기반인 경우:**
```javascript
// Service Worker에서 주기적 상태 체크
// Background Sync API 활용
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'heartbeat-check') {
    event.waitUntil(sendHeartbeat());
  }
});
```

### 1-2. JavaScript 에러 격리

```javascript
// 전역 에러 핸들러 — 크래시 방지
window.addEventListener('error', (e) => {
  console.error('[Stability] Uncaught error:', e.error);
  e.preventDefault(); // 크래시 방지
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Stability] Unhandled rejection:', e.reason);
  e.preventDefault();
});
```

---

## 2. 절전 모드 방지

감시 중에는 절전/화면 꺼짐/대기 모드 진입을 차단해야 합니다.

### 2-1. Wake Lock API (브라우저)

```javascript
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      // 자동 재획득
      if (isMonitoringActive) requestWakeLock();
    });
  } catch (err) {
    console.warn('[WakeLock] Failed:', err);
  }
}

// 감시 시작 시 호출
// 감시 종료 시 wakeLock.release()
```

### 2-2. Electron — powerSaveBlocker

```javascript
const { powerSaveBlocker } = require('electron');

let blockerId = null;

function preventSleep() {
  blockerId = powerSaveBlocker.start('prevent-display-sleep');
}

function allowSleep() {
  if (blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}
```

### 2-3. OS 레벨 (백업)

| OS | 명령어 |
|----|--------|
| Windows | `powercfg /change standby-timeout-ac 0` |
| macOS | `caffeinate -d` (display sleep 방지) |
| Linux | `systemd-inhibit --what=idle` |

> ⚠️ 감시 시작 시 활성화, 감시 종료 시 원래 설정으로 복원

---

## 3. 네트워크 단절 대응

### 3-1. 오프라인 큐잉

네트워크가 끊기면 경보 이벤트를 로컬에 저장하고, 복구 시 일괄 전송합니다.

```typescript
const offlineQueue: QueueItem[] = [];

interface QueueItem {
  type: 'alert' | 'heartbeat' | 'photo';
  payload: unknown;
  timestamp: number;
}

function enqueue(item: Omit<QueueItem, 'timestamp'>) {
  offlineQueue.push({ ...item, timestamp: Date.now() });
  // IndexedDB에도 백업
  saveToIndexedDB('offline_queue', offlineQueue);
}

// 네트워크 복구 시
window.addEventListener('online', async () => {
  console.log('[OfflineQueue] Network restored, flushing queue...');
  const items = [...offlineQueue];
  offlineQueue.length = 0;
  
  for (const item of items) {
    try {
      await sendToServer(item);
    } catch (err) {
      // 실패하면 다시 큐에 넣기
      offlineQueue.push(item);
    }
  }
});
```

### 3-2. Realtime 채널 자동 재연결

```typescript
// Supabase Realtime은 내부적으로 재연결을 시도하지만,
// CHANNEL_ERROR 상태에 빠지면 수동 재구독 필요

const channel = supabase.channel(`device-commands-${deviceId}`);

// 주기적 건강성 체크 (30초마다)
setInterval(() => {
  const state = channel.state;
  if (state === 'errored' || state === 'closed') {
    console.warn('[Realtime] Channel unhealthy, re-subscribing...');
    supabase.removeChannel(channel);
    // 새 채널로 재구독
    resubscribe();
  }
}, 30000);
```

### 3-3. 하트비트 연속성 보장

```typescript
// 네트워크 상태와 무관하게 항상 하트비트 시도
setInterval(async () => {
  if (!navigator.onLine) {
    console.log('[Heartbeat] Offline — skipping but keeping timer');
    return;
  }
  
  try {
    await updateHeartbeat();
  } catch (err) {
    console.warn('[Heartbeat] Failed:', err);
    // 실패해도 타이머는 유지 — 다음 주기에 재시도
  }
}, 60000); // 1분 간격
```

---

## 4. 메모리 누수 방지

### 4-1. 카메라 스트림 관리

```typescript
// 사용하지 않는 MediaStream 즉시 해제
function releaseStream(stream: MediaStream) {
  stream.getTracks().forEach(track => {
    track.stop();
    stream.removeTrack(track);
  });
}

// WebRTC PeerConnection 정리
function cleanupPeerConnection(pc: RTCPeerConnection) {
  pc.getSenders().forEach(sender => {
    if (sender.track) sender.track.stop();
  });
  pc.close();
}
```

### 4-2. 이벤트 리스너 정리

```typescript
// AbortController 패턴으로 일괄 정리
const controller = new AbortController();

document.addEventListener('mousemove', onMouseMove, { signal: controller.signal });
document.addEventListener('keydown', onKeyDown, { signal: controller.signal });
// ...

// 감시 종료 시 모든 리스너 한 번에 제거
controller.abort();
```

### 4-3. 캔버스/이미지 버퍼 정리

```typescript
// 모션 감지 시 사용하는 캔버스 메모리 관리
function clearCanvasMemory(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}
```

---

## 5. 서버 사이드 감시 연동

서버(pg_cron)에서 2분마다 하트비트를 체크하며, 5분 이상 무응답 시:
1. 해당 기기를 `offline` 상태로 전환
2. `is_monitoring`을 `false`로 설정
3. `alerts` 테이블에 `offline` 타입 경고 삽입
4. 스마트폰 앱이 이를 감지하여 사용자에게 알림

**노트북 앱이 해야 할 일:**
- `last_seen_at`을 **최소 2분 이내 간격**으로 갱신
- 네트워크 복구 후 즉시 하트비트 전송
- 오프라인 전환 감지 시 로컬 경보 큐에 저장

---

## 6. 구현 체크리스트

### 필수 (Critical)
- [ ] 감시 중 절전/대기 모드 진입 차단
- [ ] JS 에러 격리 (전역 error/rejection 핸들러)
- [ ] 하트비트 60초 이내 간격으로 `last_seen_at` 갱신
- [ ] Realtime 채널 건강성 30초 체크 + 자동 재구독
- [ ] 카메라 스트림/PeerConnection 메모리 해제

### 권장 (Recommended)
- [ ] 오프라인 경보 큐 (IndexedDB 백업)
- [ ] 네트워크 복구 시 큐 플러시
- [ ] 이벤트 리스너 AbortController 패턴
- [ ] 캔버스/이미지 버퍼 주기적 정리
- [ ] 크래시 감지 + 자동 재시작 (Electron)

### 선택 (Optional)
- [ ] OS 레벨 절전 방지 명령어 연동
- [ ] 프로세스 워치독 (외부 스크립트)
- [ ] 메모리 사용량 모니터링 + 임계치 초과 시 경고
