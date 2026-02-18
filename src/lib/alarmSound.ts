/**
 * 경보음 모듈 v4 — 안정적인 stop/volume 제어
 *
 * v3 대비 변경:
 *   1. stopSound()에서 AudioContext를 close하여 스케줄된 모든 오디오 즉시 중단
 *   2. masterGain 노드로 볼륨 변경 즉시 반영
 *   3. play() 시 항상 새 AudioContext 생성 — suspend/resume 불안정성 제거
 */

export interface AlarmState {
  isAlarming: boolean;
  gen: number;
  oscillators: OscillatorNode[];
  intervals: ReturnType<typeof setInterval>[];
  audioCtx: AudioContext | null;
  masterGain: GainNode | null;
  dismissed: Set<string>;
  suppressUntil: number;
  unlocked: boolean;
  pendingPlayGen: number;
  lastStoppedAt: number;
}

const GLOBAL_KEY = '__meercop_alarm_v4';

function getState(): AlarmState {
  const w = window as unknown as Record<string, AlarmState>;
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = {
      isAlarming: false,
      gen: 0,
      oscillators: [],
      intervals: [],
      audioCtx: null,
      masterGain: null,
      dismissed: new Set<string>(),
      suppressUntil: 0,
      unlocked: false,
      pendingPlayGen: 0,
      lastStoppedAt: 0,
    };
    try {
      const lst = localStorage.getItem('meercop_last_stopped_at');
      if (lst) w[GLOBAL_KEY].lastStoppedAt = parseInt(lst, 10) || 0;
    } catch {}
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) w[GLOBAL_KEY].dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
  }
  const s = w[GLOBAL_KEY];
  if (!s.dismissed || !(s.dismissed instanceof Set)) {
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      s.dismissed = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { s.dismissed = new Set(); }
  }
  if (!Array.isArray(s.oscillators)) s.oscillators = [];
  if (!Array.isArray(s.intervals)) s.intervals = [];
  return s;
}

// ── 레거시 전역 정리 ──
(function cleanupLegacy() {
  try {
    const w = window as unknown as Record<string, Record<string, unknown>>;
    for (const key of ['__meercop_alarm', '__meercop_alarm2', '__meercop_alarm_v3']) {
      const old = w[key];
      if (!old) continue;
      if (old.iid) try { clearInterval(old.iid as ReturnType<typeof setInterval>); } catch {}
      if (old.ctx) try { (old.ctx as AudioContext).close(); } catch {}
      if (old.audioCtx) try { (old.audioCtx as AudioContext).close(); } catch {}
      if (Array.isArray(old.iids)) old.iids.forEach((id) => { try { clearInterval(id as ReturnType<typeof setInterval>); } catch {} });
      if (Array.isArray(old.intervals)) (old.intervals as ReturnType<typeof setInterval>[]).forEach((id) => { try { clearInterval(id); } catch {} });
      if (Array.isArray(old.ctxs)) old.ctxs.forEach((c) => { try { (c as AudioContext).close(); } catch {} });
      delete w[key];
    }
    if (w.__meercop_ivals) { (w.__meercop_ivals as unknown as ReturnType<typeof setInterval>[]).forEach((id) => clearInterval(id)); delete w.__meercop_ivals; }
    if (w.__meercop_ctxs) { (w.__meercop_ctxs as unknown as AudioContext[]).forEach((c) => { try { c.close(); } catch {} }); delete w.__meercop_ctxs; }
  } catch {}
})();

// ══════════════════════════════════════
// AudioContext 사전 Unlock — 모바일 핵심
// ══════════════════════════════════════

/** 사용자 제스처 컨텍스트에서 호출 — AudioContext unlock */
export function unlockAudio() {
  const s = getState();
  if (s.unlocked) {
    // 이미 unlock 됐지만 대기 중인 play가 있으면 가드 체크 후 실행
    if (s.pendingPlayGen > 0 && s.pendingPlayGen === s.gen) {
      s.pendingPlayGen = 0;
      if (!isMuted()) {
        console.log("[AlarmSound] 🔄 Executing pending play (already unlocked)");
        play();
      } else {
        console.log("[AlarmSound] ⏭ Pending play cancelled (muted)");
      }
    }
    return;
  }

  try {
    // 무음 AudioContext 생성 후 즉시 닫기 — unlock 플래그만 설정
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // unlock 확인 후 닫기 — play()에서 새 AudioContext를 생성
    ctx.close().catch(() => {});

    s.unlocked = true;
    console.log("[AlarmSound] 🔓 AudioContext unlocked");

    // unlock 성공 후 대기 중인 play가 있으면 가드 체크 후 실행
    if (s.pendingPlayGen > 0 && s.pendingPlayGen === s.gen) {
      s.pendingPlayGen = 0;
      if (!isMuted()) {
        console.log("[AlarmSound] 🔄 Executing pending play after unlock");
        play();
      } else {
        console.log("[AlarmSound] ⏭ Pending play cancelled (muted)");
      }
    }
  } catch (e) {
    console.warn("[AlarmSound] unlock failed:", e);
  }
}

// 모든 사용자 상호작용에서 unlock 시도
function setupAutoUnlock() {
  const events = ['touchstart', 'touchend', 'click', 'keydown'];
  const handler = () => { unlockAudio(); };
  events.forEach(e => document.addEventListener(e, handler, { capture: true, passive: true }));
}
setupAutoUnlock();

// ══════════════════════════════════════
// Mute
// ══════════════════════════════════════
export function isMuted(): boolean {
  try { return localStorage.getItem('meercop_alarm_muted') === 'true'; } catch { return false; }
}

export function setMuted(muted: boolean) {
  try { localStorage.setItem('meercop_alarm_muted', String(muted)); } catch {}
  if (muted) {
    stop();
  } else {
    const s = getState();
    s.lastStoppedAt = 0;
    try { localStorage.setItem('meercop_last_stopped_at', '0'); } catch {}
    s.dismissed.clear();
    try { localStorage.removeItem('meercop_dismissed_ids'); } catch {}
    s.suppressUntil = 0;
    console.log("[AlarmSound] 🔊 Unmuted — lastStoppedAt/dismissed/suppress reset");
  }
}

// ══════════════════════════════════════
// Dismissed
// ══════════════════════════════════════
export function isDismissed(alertId: string): boolean {
  return getState().dismissed.has(alertId);
}

export function addDismissed(alertId: string) {
  const s = getState();
  s.dismissed.add(alertId);
  try {
    localStorage.setItem('meercop_dismissed_ids',
      JSON.stringify(Array.from(s.dismissed).slice(-50)));
  } catch {}
}

// ══════════════════════════════════════
// Suppress
// ══════════════════════════════════════
export function isSuppressed(): boolean {
  return Date.now() < getState().suppressUntil;
}

export function suppressFor(ms: number) {
  getState().suppressUntil = Date.now() + ms;
}

// ══════════════════════════════════════
// Last Stopped At
// ══════════════════════════════════════
export function getLastStoppedAt(): number {
  return getState().lastStoppedAt || 0;
}

// ══════════════════════════════════════
// Volume
// ══════════════════════════════════════
export function getVolume(): number {
  try {
    const v = localStorage.getItem('meercop_alarm_volume');
    return v ? Math.max(0, Math.min(1, parseFloat(v))) : 0.4;
  } catch { return 0.4; }
}

export function setVolume(vol: number) {
  const clamped = Math.max(0, Math.min(1, vol));
  try { localStorage.setItem('meercop_alarm_volume', String(clamped)); } catch {}
  // 재생 중이면 masterGain으로 즉시 반영
  const s = getState();
  if (s.masterGain && s.audioCtx && s.audioCtx.state !== 'closed') {
    try { s.masterGain.gain.value = clamped; } catch {}
  }
}

// ══════════════════════════════════════
// Core: stopSound — AudioContext를 닫아 모든 오디오 즉시 중단
// ══════════════════════════════════════
function stopSound() {
  const s = getState();

  for (const iid of s.intervals) {
    try { clearInterval(iid); } catch {}
  }
  s.intervals = [];
  s.oscillators = [];
  s.masterGain = null;

  // AudioContext를 닫아 스케줄된 모든 오디오를 즉시 중단
  if (s.audioCtx) {
    try { s.audioCtx.close(); } catch {}
    s.audioCtx = null;
  }
}

// ══════════════════════════════════════
// Core: playBeepCycle
// ══════════════════════════════════════
function playBeepCycle(audioCtx: AudioContext, masterGain: GainNode): OscillatorNode[] {
  const oscs: OscillatorNode[] = [];
  const beep = (time: number, freq: number) => {
    try {
      if (audioCtx.state === 'closed') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(masterGain); // masterGain을 통해 destination으로
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.value = 1; // 개별 gain은 1, 볼륨은 masterGain이 제어
      osc.start(audioCtx.currentTime + time);
      osc.stop(audioCtx.currentTime + time + 0.2);
      oscs.push(osc);
    } catch {}
  };
  beep(0, 880); beep(0.3, 1100); beep(0.6, 880);
  beep(0.9, 1100); beep(1.2, 880); beep(1.5, 1100);
  return oscs;
}

// ══════════════════════════════════════
// Public API
// ══════════════════════════════════════
export function isPlaying(): boolean {
  return getState().isAlarming;
}

export async function play() {
  const s = getState();

  if (s.isAlarming) {
    console.log("[AlarmSound] play() skipped — already alarming");
    return;
  }
  if (isMuted()) return;

  // 항상 기존 사운드 정리
  stopSound();

  s.isAlarming = true;
  const myGen = ++s.gen;
  console.log("[AlarmSound] ▶ play (gen:", myGen, ")");

  try {
    // 항상 새 AudioContext 생성 — 이전 close()와 충돌 없음
    const audioCtx = new AudioContext();
    s.audioCtx = audioCtx;

    // masterGain 생성 — 볼륨 제어 중앙화
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = getVolume();
    masterGain.connect(audioCtx.destination);
    s.masterGain = masterGain;

    // suspended 상태면 unlock 시도
    if (audioCtx.state === 'suspended') {
      if (!s.unlocked) {
        // 사용자 제스처 없이 호출됨 — 다음 터치까지 대기
        console.warn("[AlarmSound] AudioContext suspended, no unlock — queuing for next touch");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        try { audioCtx.close(); } catch {}
        s.audioCtx = null;
        s.masterGain = null;
        return;
      }
      try {
        const buffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
        await audioCtx.resume();

        if (audioCtx.state === 'suspended') {
          console.warn("[AlarmSound] Still suspended after resume — queuing for next touch");
          s.isAlarming = false;
          s.pendingPlayGen = myGen;
          try { audioCtx.close(); } catch {}
          s.audioCtx = null;
          s.masterGain = null;
          return;
        }
      } catch {
        console.warn("[AlarmSound] Resume failed — queuing for next touch");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        try { audioCtx.close(); } catch {}
        s.audioCtx = null;
        s.masterGain = null;
        return;
      }
    }

    // gen이 바뀌었으면 stop()이 호출된 것 — 즉시 중단
    if (s.gen !== myGen) {
      console.log("[AlarmSound] play aborted (gen changed)");
      try { audioCtx.close(); } catch {}
      return;
    }

    const newOscs = playBeepCycle(audioCtx, masterGain);
    s.oscillators.push(...newOscs);

    const intervalId = setInterval(() => {
      if (!s.isAlarming || s.gen !== myGen) {
        clearInterval(intervalId);
        return;
      }

      const ctx = s.audioCtx;
      if (!ctx || ctx.state === 'closed') {
        clearInterval(intervalId);
        s.isAlarming = false;
        return;
      }

      if (isMuted()) {
        stop();
        return;
      }

      // masterGain이 없으면 중단
      if (!s.masterGain) {
        clearInterval(intervalId);
        s.isAlarming = false;
        return;
      }

      const oscs = playBeepCycle(ctx, s.masterGain);
      s.oscillators.push(...oscs);

      if (s.oscillators.length > 30) {
        s.oscillators = s.oscillators.slice(-12);
      }
    }, 2500);

    s.intervals.push(intervalId);

  } catch (err) {
    console.error("[AlarmSound] play error:", err);
    s.isAlarming = false;
    stopSound();
  }
}

export function stop() {
  const s = getState();
  const wasAlarming = s.isAlarming;

  s.isAlarming = false;
  s.pendingPlayGen = 0;
  s.gen++;
  s.lastStoppedAt = Date.now();
  try { localStorage.setItem('meercop_last_stopped_at', String(s.lastStoppedAt)); } catch {}
  stopSound();

  // 시스템 푸시 알림도 함께 닫기
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.getNotifications({ tag: 'meercop-alert' }).then(notifications => {
          notifications.forEach(n => n.close());
        });
      }).catch(() => {});
    }
  } catch {}

  if (wasAlarming) {
    console.log("[AlarmSound] ■ stop (gen:", s.gen, ")");
  }
}
