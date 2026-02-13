/**
 * 경보음 모듈 — 단순하고 예측 가능한 설계
 *
 * 규칙:
 * 1. play()를 호출하면 경보음 시작 (이미 재생 중이면 무시)
 * 2. stop()을 호출하면 즉시 중지
 * 3. mute/unmute는 localStorage에 영구 저장
 * 4. dismissedIds는 localStorage에 영구 저장 (같은 alert 재발생 방지)
 */

// ── 상태 ──
let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let playing = false;

// ── Mute ──
export function isMuted(): boolean {
  try {
    return localStorage.getItem('meercop_alarm_muted') === 'true';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem('meercop_alarm_muted', String(muted));
  } catch {}
  if (muted) stop();
}

// ── Dismissed IDs ──
function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem('meercop_dismissed_ids');
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

function saveDismissedIds(ids: Set<string>) {
  try {
    const arr = Array.from(ids).slice(-50);
    localStorage.setItem('meercop_dismissed_ids', JSON.stringify(arr));
  } catch {}
}

const dismissedIds = loadDismissedIds();

export function isDismissed(alertId: string): boolean {
  return dismissedIds.has(alertId);
}

export function addDismissed(alertId: string) {
  dismissedIds.add(alertId);
  saveDismissedIds(dismissedIds);
}

// ── Suppress (dismiss 후 일시적으로 새 알람 차단) ──
let suppressUntil = 0;

export function isSuppressed(): boolean {
  return Date.now() < suppressUntil;
}

export function suppressFor(ms: number) {
  suppressUntil = Date.now() + ms;
}

// ── 재생/정지 ──
export function isPlaying(): boolean {
  return playing;
}

export function play() {
  if (playing) return;
  if (isMuted()) return;

  stop(); // 잔여 리소스 정리

  playing = true;
  console.log("[AlarmSound] ▶ Start");

  try {
    audioCtx = new AudioContext();

    const beepCycle = () => {
      if (!playing || !audioCtx || audioCtx.state === 'closed') {
        stop();
        return;
      }
      // 재생 중에도 mute 체크
      if (isMuted()) {
        stop();
        return;
      }
      const beep = (time: number, freq: number) => {
        try {
          if (!audioCtx || audioCtx.state === 'closed') return;
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.frequency.value = freq;
          osc.type = "square";
          gain.gain.value = 0.4;
          osc.start(audioCtx.currentTime + time);
          osc.stop(audioCtx.currentTime + time + 0.2);
        } catch {}
      };
      beep(0, 880);
      beep(0.3, 1100);
      beep(0.6, 880);
      beep(0.9, 1100);
      beep(1.2, 880);
      beep(1.5, 1100);
    };

    beepCycle();
    intervalId = setInterval(beepCycle, 2500);
  } catch {
    stop();
  }
}

export function stop() {
  playing = false;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (audioCtx) {
    try {
      audioCtx.suspend().catch(() => {});
      audioCtx.close().catch(() => {});
    } catch {}
    audioCtx = null;
  }

  console.log("[AlarmSound] ■ Stop");
}
