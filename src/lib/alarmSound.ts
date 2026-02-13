/**
 * 경보음 모듈 v3 — 랩탑 useAlarmSystem.ts 패턴 기반
 *
 * 핵심 원칙:
 *   1. AudioContext를 사용자 제스처 시 미리 unlock (모바일 필수)
 *   2. stopSound()를 항상 play 전에 호출 — 고아 리소스 차단
 *   3. isAlarming 플래그로 중복 오실레이터 방지
 *   4. 모든 상태를 window 전역에 저장 — 다중 번들 안전
 */

interface AlarmState {
  isAlarming: boolean;
  gen: number;
  oscillators: OscillatorNode[];
  intervals: ReturnType<typeof setInterval>[];
  audioCtx: AudioContext | null;
  dismissed: Set<string>;
  suppressUntil: number;
  unlocked: boolean;
  pendingPlayGen: number; // 0=없음, >0=play 실패 시 해당 gen에서 대기
  lastStoppedAt: number; // stop() 호출 시각 — 이전 경보 재트리거 차단
}

const GLOBAL_KEY = '__meercop_alarm_v3';

function getState(): AlarmState {
  const w = window as any;
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = {
      isAlarming: false,
      gen: 0,
      oscillators: [],
      intervals: [],
      audioCtx: null,
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
  const s = w[GLOBAL_KEY] as AlarmState;
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
    const w = window as any;
    for (const key of ['__meercop_alarm', '__meercop_alarm2']) {
      const old = w[key];
      if (!old) continue;
      if (old.iid) try { clearInterval(old.iid); } catch {}
      if (old.ctx) try { old.ctx.close(); } catch {}
      if (Array.isArray(old.iids)) old.iids.forEach((id: any) => { try { clearInterval(id); } catch {} });
      if (Array.isArray(old.ctxs)) old.ctxs.forEach((c: any) => { try { c.close(); } catch {} });
      delete w[key];
    }
    if (w.__meercop_ivals) { w.__meercop_ivals.forEach((id: any) => clearInterval(id)); delete w.__meercop_ivals; }
    if (w.__meercop_ctxs) { w.__meercop_ctxs.forEach((c: any) => { try { c.close(); } catch {} }); delete w.__meercop_ctxs; }
  } catch {}
})();

// ══════════════════════════════════════
// AudioContext 사전 Unlock — 모바일 핵심
// 사용자의 첫 터치/클릭 시 AudioContext를 생성하고
// 무음 버퍼를 재생하여 브라우저의 오디오 정책을 unlock합니다.
// 이후 경보 시 이 AudioContext를 재사용합니다.
// ══════════════════════════════════════

function ensureAudioContext(): AudioContext {
  const s = getState();
  if (s.audioCtx && s.audioCtx.state !== 'closed') {
    return s.audioCtx;
  }
  const ctx = new AudioContext();
  s.audioCtx = ctx;
  return ctx;
}

/** 사용자 제스처 컨텍스트에서 호출 — AudioContext unlock */
export function unlockAudio() {
  const s = getState();
  if (s.unlocked && s.audioCtx && s.audioCtx.state === 'running') {
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
    const ctx = ensureAudioContext();
    // 무음 버퍼 재생으로 unlock
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    s.unlocked = true;
    console.log("[AlarmSound] 🔓 AudioContext unlocked (state:", ctx.state, ")");

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

// 모든 사용자 상호작용에서 unlock 시도 — 리스너를 제거하지 않음
// pendingPlay가 나중에 설정될 수 있으므로 항상 활성 상태 유지
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
  if (muted) stop();
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
// Last Stopped At — 이전 경보 재트리거 차단
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
  try { localStorage.setItem('meercop_alarm_volume', String(Math.max(0, Math.min(1, vol)))); } catch {}
}

// ══════════════════════════════════════
// Core: stopSound
// ══════════════════════════════════════
function stopSound() {
  const s = getState();

  for (const iid of s.intervals) {
    try { clearInterval(iid); } catch {}
  }
  s.intervals = [];

  for (const osc of s.oscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  s.oscillators = [];

  // AudioContext는 닫지 않고 유지 (재사용을 위해)
  // unlock된 AudioContext를 닫으면 다시 사용자 제스처가 필요함
}

// ══════════════════════════════════════
// Core: playBeepCycle
// ══════════════════════════════════════
function playBeepCycle(audioCtx: AudioContext, volume: number): OscillatorNode[] {
  const oscs: OscillatorNode[] = [];
  const beep = (time: number, freq: number) => {
    try {
      if (audioCtx.state === 'closed') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.value = volume;
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
    const audioCtx = ensureAudioContext();

    // suspended 상태면 강제 unlock (무음 버퍼 재생 + resume)
    if (audioCtx.state === 'suspended' || !s.unlocked) {
      try {
        // 무음 버퍼로 브라우저 오디오 정책 우회
        const buffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
        await audioCtx.resume();
        
        // resume()이 throw하지 않아도 여전히 suspended일 수 있음 (사용자 제스처 없이 호출된 경우)
        if (audioCtx.state === 'suspended') {
          console.warn("[AlarmSound] AudioContext still suspended after resume — queuing for next touch");
          s.isAlarming = false;
          s.pendingPlayGen = myGen;
          return;
        }
        
        s.unlocked = true;
        console.log("[AlarmSound] 🔓 Force-unlocked in play() (state:", audioCtx.state, ")");
      } catch {
        console.warn("[AlarmSound] AudioContext resume failed — queuing for next touch");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        return;
      }
    }

    // gen이 바뀌었으면 stop()이 호출된 것 — 즉시 중단
    if (s.gen !== myGen) {
      console.log("[AlarmSound] play aborted (gen changed)");
      return;
    }

    const vol = getVolume();
    const newOscs = playBeepCycle(audioCtx, vol);
    s.oscillators.push(...newOscs);

    const intervalId = setInterval(() => {
      // gen 불일치 또는 isAlarming false → 즉시 중단
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

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const v = getVolume();
      const oscs = playBeepCycle(ctx, v);
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
  // 클럭 스큐(디바이스 간 시계 차이) 대응: 1초 버퍼 추가
  s.lastStoppedAt = Date.now() + 1000;
  try { localStorage.setItem('meercop_last_stopped_at', String(s.lastStoppedAt)); } catch {}
  stopSound();

  if (wasAlarming) {
    console.log("[AlarmSound] ■ stop (gen:", s.gen, ")");
  }
}
