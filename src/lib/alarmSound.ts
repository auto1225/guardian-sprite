/**
 * 경보음 모듈 v5 — 사용자 설정 경보음 + 안정적 stop/volume 제어
 *
 * v4 대비 변경:
 *   1. 사용자가 설정에서 선택한 alarm_sound_id에 따라 경보음 패턴 변경
 *   2. 커스텀 사운드 지원 (localStorage에 저장된 오디오 파일 재생)
 *   3. 억제 시간 10초로 증가 (Presence 재트리거 방지)
 */

// ── 경보음 정의 (SettingsComponents.tsx의 ALARM_SOUNDS와 동일) ──
const ALARM_SOUND_CONFIGS: Record<string, { freq: number[]; pattern: number[] }> = {
  whistle: { freq: [2200, 1800], pattern: [0.15, 0.1] },
  siren: { freq: [660, 880], pattern: [0.3, 0.3] },
  bird: { freq: [1400, 1800, 2200], pattern: [0.1, 0.08, 0.12] },
  police: { freq: [600, 1200], pattern: [0.5, 0.5] },
  radio: { freq: [440, 520, 600], pattern: [0.2, 0.15, 0.2] },
  quiet: { freq: [400, 500], pattern: [0.4, 0.4] },
};

export interface AlarmState {
  isAlarming: boolean;
  gen: number;
  oscillators: OscillatorNode[];
  intervals: ReturnType<typeof setInterval>[];
  audioCtx: AudioContext | null;
  masterGain: GainNode | null;
  customAudio: HTMLAudioElement | null;
  dismissed: Set<string>;
  suppressUntil: number;
  unlocked: boolean;
  pendingPlayGen: number;
  lastStoppedAt: number;
}

const GLOBAL_KEY = '__meercop_alarm_v5';

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
      customAudio: null,
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
    for (const key of ['__meercop_alarm', '__meercop_alarm2', '__meercop_alarm_v3', '__meercop_alarm_v4']) {
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
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    ctx.close().catch(() => {});

    s.unlocked = true;
    console.log("[AlarmSound] 🔓 AudioContext unlocked");

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
  const s = getState();
  if (s.masterGain && s.audioCtx && s.audioCtx.state !== 'closed') {
    try { s.masterGain.gain.value = clamped; } catch {}
  }
  // 커스텀 오디오 볼륨도 업데이트
  if (s.customAudio) {
    try { s.customAudio.volume = clamped; } catch {}
  }
}

// ══════════════════════════════════════
// Sound ID
// ══════════════════════════════════════
export function getSelectedSoundId(): string {
  try {
    return localStorage.getItem('meercop_alarm_sound_id') || 'whistle';
  } catch { return 'whistle'; }
}

export function setSelectedSoundId(soundId: string) {
  try { localStorage.setItem('meercop_alarm_sound_id', soundId); } catch {}
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
  s.oscillators = [];
  s.masterGain = null;

  if (s.audioCtx) {
    try { s.audioCtx.close(); } catch {}
    s.audioCtx = null;
  }

  // 커스텀 오디오 정지
  if (s.customAudio) {
    try { s.customAudio.pause(); s.customAudio.currentTime = 0; } catch {}
    s.customAudio = null;
  }
}

// ══════════════════════════════════════
// Core: playSoundCycle — 선택된 경보음 패턴으로 재생
// ══════════════════════════════════════
function playSoundCycle(audioCtx: AudioContext, masterGain: GainNode, soundConfig: { freq: number[]; pattern: number[] }): OscillatorNode[] {
  const oscs: OscillatorNode[] = [];
  const beep = (time: number, freq: number, duration: number) => {
    try {
      if (audioCtx.state === 'closed') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.value = 1;
      osc.start(audioCtx.currentTime + time);
      osc.stop(audioCtx.currentTime + time + duration);
      oscs.push(osc);
    } catch {}
  };

  let t = 0;
  // 한 사이클: 패턴을 2번 반복하여 충분한 길이 확보
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let i = 0; i < soundConfig.freq.length; i++) {
      beep(t, soundConfig.freq[i], soundConfig.pattern[i]);
      t += soundConfig.pattern[i] + 0.05;
    }
    t += 0.1; // 반복 간 간격
  }

  return oscs;
}

// ══════════════════════════════════════
// Custom Sound Playback
// ══════════════════════════════════════
function playCustomSound(deviceId: string | null, volume: number, gen: number): boolean {
  const s = getState();
  
  // deviceId가 없으면 모든 기기의 커스텀 사운드 키를 검색
  let dataUrl: string | null = null;
  if (deviceId) {
    dataUrl = localStorage.getItem(`meercop_custom_sound_${deviceId}`);
  }
  if (!dataUrl) {
    // 현재 선택된 기기의 커스텀 사운드를 찾기 위해 모든 키 검색
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('meercop_custom_sound_')) {
          dataUrl = localStorage.getItem(key);
          if (dataUrl) break;
        }
      }
    } catch {}
  }
  
  if (!dataUrl) return false;

  try {
    const audio = new Audio(dataUrl);
    audio.volume = volume;
    audio.loop = true;
    s.customAudio = audio;
    
    audio.play().catch((err) => {
      console.warn("[AlarmSound] Custom audio play failed:", err);
      // 커스텀 실패 시 기본 비프음으로 폴백
      s.customAudio = null;
    });
    
    return true;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════
// Public API
// ══════════════════════════════════════
export function isPlaying(): boolean {
  return getState().isAlarming;
}

export async function play(deviceId?: string) {
  const s = getState();

  if (s.isAlarming) {
    console.log("[AlarmSound] play() skipped — already alarming");
    return;
  }
  if (isMuted()) return;

  stopSound();

  s.isAlarming = true;
  const myGen = ++s.gen;
  const soundId = getSelectedSoundId();
  const volume = getVolume();
  console.log("[AlarmSound] ▶ play (gen:", myGen, "sound:", soundId, "vol:", volume, ")");

  // 커스텀 사운드 처리
  if (soundId === 'custom') {
    const played = playCustomSound(deviceId || null, volume, myGen);
    if (played) {
      console.log("[AlarmSound] 🎵 Playing custom sound");
      return;
    }
    console.log("[AlarmSound] ⚠️ Custom sound not found, falling back to whistle");
  }

  // 내장 사운드 재생
  const soundConfig = ALARM_SOUND_CONFIGS[soundId] || ALARM_SOUND_CONFIGS.whistle;

  try {
    const audioCtx = new AudioContext();
    s.audioCtx = audioCtx;

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
    s.masterGain = masterGain;

    if (audioCtx.state === 'suspended') {
      if (!s.unlocked) {
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

    if (s.gen !== myGen) {
      console.log("[AlarmSound] play aborted (gen changed)");
      try { audioCtx.close(); } catch {}
      return;
    }

    const newOscs = playSoundCycle(audioCtx, masterGain, soundConfig);
    s.oscillators.push(...newOscs);

    // 사이클 간격 계산: 패턴 총 길이 * 2 + 여유
    const cycleLength = soundConfig.pattern.reduce((a, b) => a + b + 0.05, 0) * 2 + 0.3;
    const intervalMs = Math.max(2000, cycleLength * 1000 + 500);

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

      if (!s.masterGain) {
        clearInterval(intervalId);
        s.isAlarming = false;
        return;
      }

      const oscs = playSoundCycle(ctx, s.masterGain, soundConfig);
      s.oscillators.push(...oscs);

      if (s.oscillators.length > 30) {
        s.oscillators = s.oscillators.slice(-12);
      }
    }, intervalMs);

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