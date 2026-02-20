/**
 * 경보음 모듈 v11 — Window-Global Singleton AudioContext
 *
 * v10에서의 문제:
 *   - audioCtx, gainNode 등이 모듈 레벨 변수여서
 *     코드 분할/HMR 등으로 모듈 인스턴스가 2개 이상 생성되면
 *     이전 인스턴스의 AudioContext가 정리되지 않아 이중 경보음 발생
 *
 * v11 해결:
 *   - 모든 오디오 참조를 window.__meercop_audio_v11에 저장
 *   - 어떤 모듈 인스턴스에서든 같은 참조를 공유
 *   - play() 전에 기존 오디오를 확실히 정리
 */

// ── 경보음 정의 ──
const ALARM_SOUND_CONFIGS: Record<string, { freq: number[]; pattern: number[] }> = {
  whistle: { freq: [2200, 1800], pattern: [0.15, 0.1] },
  siren: { freq: [660, 880], pattern: [0.3, 0.3] },
  bird: { freq: [1400, 1800, 2200], pattern: [0.1, 0.08, 0.12] },
  police: { freq: [600, 1200], pattern: [0.5, 0.5] },
  radio: { freq: [440, 520, 600], pattern: [0.2, 0.15, 0.2] },
  quiet: { freq: [400, 500], pattern: [0.4, 0.4] },
};

// ══════════════════════════════════════
// Window-Global 오디오 참조 (싱글톤 보장)
// ══════════════════════════════════════
const AUDIO_KEY = '__meercop_audio_v11';

interface AudioRefs {
  ctx: AudioContext | null;
  gain: GainNode | null;
  oscillators: OscillatorNode[];
  interval: ReturnType<typeof setInterval> | null;
  customAudio: HTMLAudioElement | null;
}

function getAudioRefs(): AudioRefs {
  const w = window as unknown as Record<string, AudioRefs>;
  if (!w[AUDIO_KEY]) {
    w[AUDIO_KEY] = {
      ctx: null,
      gain: null,
      oscillators: [],
      interval: null,
      customAudio: null,
    };
  }
  return w[AUDIO_KEY];
}

// ══════════════════════════════════════
// 레거시 전역 레지스트리 정리 (이전 버전 + v10 모듈 변수 대응)
// ══════════════════════════════════════
const LEGACY_KEYS = [
  '__meercop_audio_registry', '__meercop_all_intervals',
  '__meercop_all_audios', '__meercop_all_oscillators', '__meercop_all_gains',
];

function nukeLegacy() {
  const w = window as unknown as Record<string, unknown>;

  // 레거시 레지스트리 정리
  for (const key of LEGACY_KEYS) {
    const arr = w[key] as unknown[] | undefined;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      try {
        if (item && typeof item === 'object' && 'state' in item) {
          const ctx = item as AudioContext;
          if (ctx.state !== 'closed') { ctx.suspend().catch(() => {}); ctx.close().catch(() => {}); }
        } else if (item && typeof item === 'object' && 'pause' in item) {
          const audio = item as HTMLAudioElement;
          audio.pause(); audio.src = ''; audio.load();
        } else if (typeof item === 'number') {
          clearInterval(item);
        } else if (item && typeof item === 'object' && 'stop' in item) {
          (item as OscillatorNode).stop();
        } else if (item && typeof item === 'object' && 'disconnect' in item) {
          (item as AudioNode).disconnect();
        }
      } catch {}
    }
    w[key] = [];
  }

  // 레거시 __meercop_alarm* 전역 객체 (v9 이하)
  for (const key of Object.keys(w)) {
    if (!key.startsWith('__meercop_alarm')) continue;
    // v10 state는 건드리지 않음 (아래에서 마이그레이션)
    if (key === '__meercop_alarm_state_v10') continue;
    const old = w[key] as Record<string, unknown> | undefined;
    if (!old || typeof old !== 'object') continue;
    old.isAlarming = false;
    old.pendingPlayGen = 0;
    if (old.audioCtx) try { (old.audioCtx as AudioContext).close(); } catch {}
    if (old.ctx) try { (old.ctx as AudioContext).close(); } catch {}
    if (old.customAudio) try { (old.customAudio as HTMLAudioElement).pause(); } catch {}
    if (Array.isArray(old.intervals)) (old.intervals as ReturnType<typeof setInterval>[]).forEach(id => { try { clearInterval(id); } catch {} });
    if (Array.isArray(old.oscillators)) (old.oscillators as OscillatorNode[]).forEach(o => { try { o.stop(); } catch {} });
    old.intervals = [];
    old.oscillators = [];
    old.audioCtx = null;
    old.masterGain = null;
  }

  // ★ v10 → v11 마이그레이션: v10의 모듈 레벨 AudioContext도 정리
  // v10 state 객체가 있으면 isAlarming을 false로 설정
  const v10State = w['__meercop_alarm_state_v10'] as Record<string, unknown> | undefined;
  if (v10State && typeof v10State === 'object') {
    v10State.isAlarming = false;
    v10State.pendingPlayGen = 0;
  }
}
nukeLegacy();

// ══════════════════════════════════════
// 상태 관리 (dismiss, suppress 등)
// ══════════════════════════════════════
interface AlarmState {
  isAlarming: boolean;
  gen: number;
  dismissed: Set<string>;
  suppressUntil: number;
  unlocked: boolean;
  pendingPlayGen: number;
  lastStoppedAt: number;
}

const STATE_KEY = '__meercop_alarm_state_v11';

function getState(): AlarmState {
  const w = window as unknown as Record<string, AlarmState>;
  if (!w[STATE_KEY]) {
    w[STATE_KEY] = {
      isAlarming: false,
      gen: 0,
      dismissed: new Set<string>(),
      suppressUntil: 0,
      unlocked: false,
      pendingPlayGen: 0,
      lastStoppedAt: 0,
    };
    // v10 state에서 마이그레이션
    const v10 = w['__meercop_alarm_state_v10'] as AlarmState | undefined;
    if (v10) {
      if (v10.dismissed instanceof Set) w[STATE_KEY].dismissed = new Set(v10.dismissed);
      if (v10.lastStoppedAt) w[STATE_KEY].lastStoppedAt = v10.lastStoppedAt;
      if (v10.suppressUntil > Date.now()) w[STATE_KEY].suppressUntil = v10.suppressUntil;
      if (v10.unlocked) w[STATE_KEY].unlocked = true;
    }
    try {
      const lst = localStorage.getItem('meercop_last_stopped_at');
      if (lst) {
        const val = parseInt(lst, 10) || 0;
        if (val > w[STATE_KEY].lastStoppedAt) w[STATE_KEY].lastStoppedAt = val;
      }
    } catch {}
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        for (const id of ids) w[STATE_KEY].dismissed.add(id);
      }
    } catch {}
  }
  const s = w[STATE_KEY];
  if (!s.dismissed || !(s.dismissed instanceof Set)) {
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      s.dismissed = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { s.dismissed = new Set(); }
  }
  return s;
}

// ══════════════════════════════════════
// AudioContext 초기화
// ══════════════════════════════════════
function initAudio() {
  const refs = getAudioRefs();
  if (refs.ctx && refs.ctx.state !== 'closed') return;

  refs.ctx = new AudioContext();
  refs.gain = refs.ctx.createGain();
  refs.gain.connect(refs.ctx.destination);
  refs.gain.gain.value = getVolume();
  console.log("[AlarmSound] 🔊 AudioContext + GainNode initialized");
}

// ══════════════════════════════════════
// AudioContext Unlock — 모바일 핵심
// ══════════════════════════════════════
export function unlockAudio() {
  const s = getState();
  if (s.unlocked) {
    if (s.pendingPlayGen > 0 && s.pendingPlayGen === s.gen) {
      s.pendingPlayGen = 0;
      if (!isMuted()) {
        console.log("[AlarmSound] 🔄 Executing pending play (already unlocked)");
        play();
      }
    }
    return;
  }

  try {
    initAudio();
    const refs = getAudioRefs();
    if (refs.ctx && refs.ctx.state === 'suspended') {
      refs.ctx.resume().catch(() => {});
    }
    if (refs.ctx) {
      const buffer = refs.ctx.createBuffer(1, 1, 22050);
      const source = refs.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(refs.ctx.destination);
      source.start(0);
    }

    s.unlocked = true;
    console.log("[AlarmSound] 🔓 AudioContext unlocked");

    if (s.pendingPlayGen > 0 && s.pendingPlayGen === s.gen) {
      s.pendingPlayGen = 0;
      if (!isMuted()) {
        console.log("[AlarmSound] 🔄 Executing pending play after unlock");
        play();
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
// Mute / Dismiss / Suppress / LastStopped
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
    console.log("[AlarmSound] 🔊 Unmuted — all state reset");
  }
}

export function isDismissed(alertId: string): boolean { return getState().dismissed.has(alertId); }
export function addDismissed(alertId: string) {
  const s = getState();
  s.dismissed.add(alertId);
  try { localStorage.setItem('meercop_dismissed_ids', JSON.stringify(Array.from(s.dismissed).slice(-50))); } catch {}
}

export function isSuppressed(): boolean { return Date.now() < getState().suppressUntil; }
export function suppressFor(ms: number) { getState().suppressUntil = Date.now() + ms; }
export function getLastStoppedAt(): number { return getState().lastStoppedAt || 0; }

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
  const refs = getAudioRefs();
  if (refs.gain && refs.ctx && refs.ctx.state !== 'closed') {
    refs.gain.gain.setTargetAtTime(clamped, refs.ctx.currentTime, 0.01);
  }
  if (refs.customAudio) {
    try { refs.customAudio.volume = clamped; } catch {}
  }
}

// ══════════════════════════════════════
// Sound ID
// ══════════════════════════════════════
export function getSelectedSoundId(): string {
  try { return localStorage.getItem('meercop_alarm_sound_id') || 'whistle'; } catch { return 'whistle'; }
}
export function setSelectedSoundId(soundId: string) {
  try { localStorage.setItem('meercop_alarm_sound_id', soundId); } catch {}
}

// ══════════════════════════════════════
// 모든 소스 정지 (동기적) — window-global 참조 사용
// ══════════════════════════════════════
function killAllSources() {
  const refs = getAudioRefs();

  // 1. 반복 인터벌 먼저 정지
  if (refs.interval) {
    clearInterval(refs.interval);
    refs.interval = null;
  }

  // 2. 오실레이터 즉시 정지 + 연결 해제
  for (const osc of refs.oscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  refs.oscillators = [];

  // 3. 커스텀 오디오 정지
  if (refs.customAudio) {
    try { refs.customAudio.pause(); refs.customAudio.currentTime = 0; refs.customAudio.src = ''; refs.customAudio.load(); } catch {}
    refs.customAudio = null;
  }

  // 4. GainNode 무음
  if (refs.gain) {
    try { refs.gain.gain.value = 0; } catch {}
  }

  // 5. AudioContext 완전 파기
  if (refs.ctx && refs.ctx.state !== 'closed') {
    try { refs.ctx.close().catch(() => {}); } catch {}
  }
  refs.ctx = null;
  refs.gain = null;
  console.log("[AlarmSound] 🔇 killAllSources: AudioContext destroyed");
}

// ══════════════════════════════════════
// Core: playSoundCycle
// ══════════════════════════════════════
function playSoundCycle(soundConfig: { freq: number[]; pattern: number[] }) {
  const refs = getAudioRefs();
  if (!refs.ctx || refs.ctx.state === 'closed' || !refs.gain) return;

  let t = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let i = 0; i < soundConfig.freq.length; i++) {
      try {
        const osc = refs.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = soundConfig.freq[i];
        osc.connect(refs.gain);
        osc.start(refs.ctx.currentTime + t);
        osc.stop(refs.ctx.currentTime + t + soundConfig.pattern[i]);
        refs.oscillators.push(osc);
        osc.onended = () => {
          const idx = refs.oscillators.indexOf(osc);
          if (idx >= 0) refs.oscillators.splice(idx, 1);
        };
      } catch {}
      t += soundConfig.pattern[i] + 0.05;
    }
    t += 0.1;
  }
}

// ══════════════════════════════════════
// Custom Sound Playback
// ══════════════════════════════════════
function playCustomSound(volume: number): boolean {
  let dataUrl: string | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('meercop_custom_sound_')) {
        dataUrl = localStorage.getItem(key);
        if (dataUrl) break;
      }
    }
  } catch {}

  if (!dataUrl) return false;

  try {
    const refs = getAudioRefs();
    refs.customAudio = new Audio(dataUrl);
    refs.customAudio.volume = volume;
    refs.customAudio.loop = true;
    refs.customAudio.play().catch((err) => {
      console.warn("[AlarmSound] Custom audio play failed:", err);
    });
    return true;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════
// Public API
// ══════════════════════════════════════
export function isPlaying(): boolean { return getState().isAlarming; }

export async function play(_deviceId?: string) {
  const s = getState();

  if (s.isAlarming) {
    console.log("[AlarmSound] play() skipped — already alarming");
    return;
  }
  if (isMuted()) return;
  if (isSuppressed()) {
    console.log("[AlarmSound] play() blocked — suppressed for",
      Math.round((s.suppressUntil - Date.now()) / 1000), "s more");
    return;
  }
  const timeSinceStop = Date.now() - s.lastStoppedAt;
  if (s.lastStoppedAt > 0 && timeSinceStop < 3000) {
    console.log("[AlarmSound] play() blocked — stopped", Math.round(timeSinceStop / 1000), "s ago");
    return;
  }

  // 기존 소스 완전 정리
  killAllSources();

  s.isAlarming = true;
  const myGen = ++s.gen;
  const soundId = getSelectedSoundId();
  const volume = getVolume();
  console.log("[AlarmSound] ▶ play (gen:", myGen, "sound:", soundId, "vol:", volume, ")");

  // 커스텀 사운드
  if (soundId === 'custom') {
    if (playCustomSound(volume)) {
      console.log("[AlarmSound] 🎵 Playing custom sound");
      return;
    }
    console.log("[AlarmSound] ⚠️ Custom sound not found, falling back to whistle");
  }

  // AudioContext 초기화
  initAudio();
  const refs = getAudioRefs();
  if (!refs.ctx || !refs.gain) {
    s.isAlarming = false;
    return;
  }

  // 볼륨 설정
  refs.gain.gain.value = volume;

  // 브라우저 정책 대응
  if (refs.ctx.state === 'suspended') {
    if (!s.unlocked) {
      console.warn("[AlarmSound] AudioContext suspended, no unlock — queuing");
      s.isAlarming = false;
      s.pendingPlayGen = myGen;
      return;
    }
    try {
      await refs.ctx.resume();
      if (refs.ctx.state === 'suspended') {
        console.warn("[AlarmSound] Still suspended — queuing");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        return;
      }
    } catch {
      s.isAlarming = false;
      s.pendingPlayGen = myGen;
      return;
    }
  }

  if (s.gen !== myGen) return;
  if (isSuppressed()) { s.isAlarming = false; return; }

  // 내장 사운드 재생
  const soundConfig = ALARM_SOUND_CONFIGS[soundId] || ALARM_SOUND_CONFIGS.whistle;
  playSoundCycle(soundConfig);

  // 반복 재생
  const cycleLength = soundConfig.pattern.reduce((a, b) => a + b + 0.05, 0) * 2 + 0.3;
  const intervalMs = Math.max(2000, cycleLength * 1000 + 500);

  refs.interval = setInterval(() => {
    if (!s.isAlarming || s.gen !== myGen) {
      const r = getAudioRefs();
      if (r.interval) { clearInterval(r.interval); r.interval = null; }
      return;
    }
    if (isMuted() || isSuppressed()) {
      stop();
      return;
    }
    const r = getAudioRefs();
    if (r.ctx && r.ctx.state === 'closed') {
      if (r.interval) { clearInterval(r.interval); r.interval = null; }
      s.isAlarming = false;
      return;
    }
    playSoundCycle(soundConfig);
  }, intervalMs);
}

export function stop() {
  const s = getState();
  const wasAlarming = s.isAlarming;

  s.isAlarming = false;
  s.pendingPlayGen = 0;
  s.gen++;
  s.lastStoppedAt = Date.now();
  try { localStorage.setItem('meercop_last_stopped_at', String(s.lastStoppedAt)); } catch {}

  // 자동 suppress 3초
  const minSuppressUntil = Date.now() + 3000;
  if (s.suppressUntil < minSuppressUntil) {
    s.suppressUntil = minSuppressUntil;
  }

  // 모든 소스를 동기적으로 즉시 정지
  killAllSources();

  // ★ v10 state도 정리 (이전 모듈 인스턴스 대응)
  const w = window as unknown as Record<string, unknown>;
  const v10State = w['__meercop_alarm_state_v10'] as Record<string, unknown> | undefined;
  if (v10State && typeof v10State === 'object') {
    v10State.isAlarming = false;
    v10State.pendingPlayGen = 0;
  }

  // 시스템 푸시 알림도 닫기
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.getNotifications().then(notifications => {
          notifications.forEach(n => {
            if (!n.tag || n.tag.startsWith('meercop')) n.close();
          });
        });
      }).catch(() => {});
    }
  } catch {}

  if (wasAlarming) {
    console.log("[AlarmSound] ■ stop (gen:", s.gen, "auto-suppress 3s)");
  }
}

// ══════════════════════════════════════
// 디버그 / 비상 정지
// ══════════════════════════════════════
export function debugAudioSources(): string[] {
  const report: string[] = [];
  const refs = getAudioRefs();
  report.push(`[AudioCtx] state: ${refs.ctx?.state ?? 'null'}`);
  report.push(`[GainNode] value: ${refs.gain?.gain?.value ?? 'null'}`);
  report.push(`[Oscillators] active: ${refs.oscillators.length}`);
  report.push(`[Interval] active: ${refs.interval !== null}`);
  report.push(`[CustomAudio] playing: ${refs.customAudio ? !refs.customAudio.paused : false}`);
  const s = getState();
  report.push(`[State] isAlarming=${s.isAlarming}, gen=${s.gen}, pendingPlay=${s.pendingPlayGen}`);
  report.push(`[State] suppressUntil=${s.suppressUntil > Date.now() ? `${Math.round((s.suppressUntil - Date.now()) / 1000)}s` : 'none'}`);
  report.push(`[State] lastStoppedAt=${s.lastStoppedAt ? `${Math.round((Date.now() - s.lastStoppedAt) / 1000)}s ago` : 'never'}`);
  return report;
}

export function emergencyKillAll(): string[] {
  const report: string[] = [];

  killAllSources();
  report.push("✅ killAllSources() done");

  nukeLegacy();
  report.push("✅ nukeLegacy() done");

  const w = window as unknown as Record<string, unknown>;
  let deleted = 0;
  for (const key of Object.keys(w)) {
    if (key.startsWith('__meercop')) {
      try { delete w[key]; deleted++; } catch {}
    }
  }
  report.push(`✅ Deleted ${deleted} __meercop* globals`);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.getNotifications().then(ns => {
        ns.forEach(n => n.close());
        console.log("[EmergencyKill] Closed notifications:", ns.length);
      });
    }).catch(() => {});
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => { r.unregister(); });
    }).catch(() => {});
  }

  return report;
}

// ══════════════════════════════════════
// re-export for compatibility
// ══════════════════════════════════════
export type { AlarmState };
