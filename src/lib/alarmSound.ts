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
// ★ AudioContext 전역 추적 (monkey-patch)
// 모든 AudioContext 인스턴스를 추적하여 stop() 시 전부 파기
// ══════════════════════════════════════
const TRACKED_CONTEXTS_KEY = '__meercop_all_audio_contexts';
const TRACKED_INTERVALS_KEY = '__meercop_all_intervals_v2';

function getTrackedContexts(): AudioContext[] {
  const w = window as unknown as Record<string, AudioContext[]>;
  if (!w[TRACKED_CONTEXTS_KEY]) w[TRACKED_CONTEXTS_KEY] = [];
  return w[TRACKED_CONTEXTS_KEY];
}

function getTrackedIntervals(): ReturnType<typeof setInterval>[] {
  const w = window as unknown as Record<string, ReturnType<typeof setInterval>[]>;
  if (!w[TRACKED_INTERVALS_KEY]) w[TRACKED_INTERVALS_KEY] = [];
  return w[TRACKED_INTERVALS_KEY];
}

function trackInterval(id: ReturnType<typeof setInterval>) {
  getTrackedIntervals().push(id);
}

function clearAllTrackedIntervals() {
  const arr = getTrackedIntervals();
  for (const id of arr) {
    try { clearInterval(id); } catch {}
  }
  arr.length = 0;
}

function installAudioContextTracker() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__meercop_ac_patched) return;
  w.__meercop_ac_patched = true;

  const OriginalAudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!OriginalAudioContext) return;

  // ★ 원본 생성자를 보존하여 알람 전용 AudioContext 생성에 사용
  (w as Record<string, unknown>).__meercop_OriginalAudioContext = OriginalAudioContext;

  const PatchedAudioContext = function (this: AudioContext, ...args: ConstructorParameters<typeof AudioContext>) {
    const instance = new OriginalAudioContext(...args);
    getTrackedContexts().push(instance);
    return instance;
  } as unknown as typeof AudioContext;

  PatchedAudioContext.prototype = OriginalAudioContext.prototype;
  Object.defineProperty(PatchedAudioContext, 'name', { value: 'AudioContext' });

  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = PatchedAudioContext;
  console.log("[AlarmSound] ✅ AudioContext tracker installed");
}
installAudioContextTracker();

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

  // ★ 이전 버전 오디오 참조 정리 (__meercop_audio_v* 중 v11 제외)
  for (const key of Object.keys(w)) {
    if (key.startsWith('__meercop_audio_') && key !== AUDIO_KEY) {
      const oldRefs = w[key] as Record<string, unknown> | undefined;
      if (!oldRefs || typeof oldRefs !== 'object') continue;
      console.log("[AlarmSound] 🧹 Cleaning legacy audio refs:", key);
      // interval 정리
      if (oldRefs.interval != null) { try { clearInterval(oldRefs.interval as ReturnType<typeof setInterval>); } catch {} oldRefs.interval = null; }
      // oscillators 정리
      if (Array.isArray(oldRefs.oscillators)) {
        for (const osc of oldRefs.oscillators as OscillatorNode[]) {
          try { osc.stop(); } catch {} try { osc.disconnect(); } catch {}
        }
        oldRefs.oscillators = [];
      }
      // customAudio 정리
      if (oldRefs.customAudio) { try { (oldRefs.customAudio as HTMLAudioElement).pause(); (oldRefs.customAudio as HTMLAudioElement).src = ''; } catch {} oldRefs.customAudio = null; }
      // gain 무음 + 정리
      if (oldRefs.gain) { try { (oldRefs.gain as GainNode).gain.value = 0; } catch {} oldRefs.gain = null; }
      // AudioContext 닫기
      if (oldRefs.ctx) {
        try { const ctx = oldRefs.ctx as AudioContext; if (ctx.state !== 'closed') { ctx.close().catch(() => {}); } } catch {}
        oldRefs.ctx = null;
      }
      // 전역에서 완전 삭제
      try { delete w[key]; } catch {}
    }
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
  const v10State = w['__meercop_alarm_state_v10'] as Record<string, unknown> | undefined;
  if (v10State && typeof v10State === 'object') {
    v10State.isAlarming = false;
    v10State.pendingPlayGen = 0;
  }

  // ★★ HMR 핵심 수정: v11 상태의 gen을 증가시켜 이전 모듈의 setInterval 콜백이
  // gen 체크(s.gen !== myGen)에서 실패하여 자동 종료되도록 함
  const v11State = w['__meercop_alarm_state_v11'] as Record<string, unknown> | undefined;
  if (v11State && typeof v11State === 'object') {
    v11State.gen = ((v11State.gen as number) || 0) + 100;
    v11State.isAlarming = false;
    v11State.pendingPlayGen = 0;
    console.log("[AlarmSound] 🔄 HMR: state gen bumped to", v11State.gen, "— all old intervals will self-terminate");
  }

  // ★ 추적된 모든 인터벌/AudioContext도 정리
  clearAllTrackedIntervals();
  const tracked = getTrackedContexts();
  for (const ctx of tracked) {
    if (ctx && ctx.state !== 'closed') {
      try { ctx.close().catch(() => {}); } catch {}
    }
  }
  tracked.length = 0;
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

  // ★ 원본 AudioContext 사용 — 추적 목록에 들어가지 않아 WebRTC와 간섭 없음
  const w = window as unknown as Record<string, unknown>;
  const OrigAC = (w.__meercop_OriginalAudioContext as typeof AudioContext) || AudioContext;
  refs.ctx = new OrigAC();
  refs.gain = refs.ctx.createGain();
  refs.gain.connect(refs.ctx.destination);
  refs.gain.gain.value = getVolume();
  console.log("[AlarmSound] 🔊 AudioContext + GainNode initialized (untracked)");
}

// ══════════════════════════════════════
// ★ Warm Audio — 모바일 핵심 전략
// 사용자 제스처 시 무음 오디오를 미리 재생하여
// WebSocket으로 경보 도착 시 제스처 없이 소리 전환 가능
// ══════════════════════════════════════
const WARM_AUDIO_KEY = '__meercop_warm_audio';

/** ArrayBuffer → base64 data URL (모바일에서 blob URL보다 확실히 동작) */
function arrayBufferToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function createSilentWav(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1초 무음
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const w = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true);
  w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, 'data'); view.setUint32(40, numSamples * 2, true);
  return arrayBufferToDataUrl(buffer);
}

function createAlarmWav(volume: number, soundId?: string): string {
  const sampleRate = 22050;
  const duration = 2; // 2초 경보음
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const w = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true);
  w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, 'data'); view.setUint32(40, numSamples * 2, true);

  const config = ALARM_SOUND_CONFIGS[soundId || 'whistle'] || ALARM_SOUND_CONFIGS.whistle;
  const totalPattern = config.pattern.reduce((a, b) => a + b, 0) + config.pattern.length * 0.05;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const cycleT = t % (totalPattern * 2 + 0.2);
    let freq = config.freq[0];
    let acc = 0;
    for (let fi = 0; fi < config.freq.length; fi++) {
      acc += config.pattern[fi] + 0.05;
      if (cycleT < acc) { freq = config.freq[fi]; break; }
      if (fi === config.freq.length - 1) freq = config.freq[0];
    }
    const gap = cycleT % (config.pattern[0] + 0.05);
    const envelope = gap < config.pattern[0] ? 1 : 0;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.4 * volume * envelope;
    view.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, sample * 32767)), true);
  }

  return arrayBufferToDataUrl(buffer);
}

function getWarmAudio(): HTMLAudioElement | null {
  return (window as unknown as Record<string, HTMLAudioElement | null>)[WARM_AUDIO_KEY] || null;
}

function setWarmAudio(audio: HTMLAudioElement | null) {
  (window as unknown as Record<string, HTMLAudioElement | null>)[WARM_AUDIO_KEY] = audio;
}

/** warm audio를 경보음으로 전환 (async — play 결과를 확인) */
async function switchWarmToAlarm(): Promise<boolean> {
  const warm = getWarmAudio();
  if (!warm) {
    console.log("[AlarmSound] switchWarmToAlarm: no warm audio element");
    return false;
  }
  try {
    const volume = getVolume();
    const soundId = getSelectedSoundId();
    const alarmUrl = createAlarmWav(volume, soundId);
    warm.src = alarmUrl;
    warm.volume = Math.min(1, volume * 2);
    warm.loop = true;
    console.log("[AlarmSound] 🔊 switchWarmToAlarm: src set, paused=", warm.paused, "calling play()...");
    await warm.play();
    console.log("[AlarmSound] 🔊 Warm audio switched to alarm sound ✅ (playing)");
    return true;
  } catch (err) {
    console.warn("[AlarmSound] switchWarmToAlarm FAILED (will use fallback):", err);
    return false;
  }
}

/** warm audio를 무음으로 되돌림 — pause하지 않고 무음 WAV 유지 (모바일 제스처 보존) */
function switchWarmToSilent() {
  const warm = getWarmAudio();
  if (!warm) return;
  try {
    // ★ 핵심: pause()하면 모바일에서 제스처 blessing을 잃으므로
    //   무음 WAV로 src를 교체하고 계속 재생 유지
    const silentUrl = createSilentWav();
    warm.src = silentUrl;
    warm.volume = 0.01;
    warm.loop = true;
    warm.play().catch(() => {
      // play 실패 시에도 warm 참조는 유지 — 다음 제스처에서 복원 가능
      console.warn("[AlarmSound] switchWarmToSilent: play failed, warm audio may need re-blessing");
    });
    console.log("[AlarmSound] 🔇 Warm audio switched to silent (STILL PLAYING — gesture preserved)");
  } catch {}
}

// ══════════════════════════════════════
// AudioContext Unlock — 모바일 핵심
// ══════════════════════════════════════
export function unlockAudio() {
  const s = getState();

  // ★ Warm Audio 생성 — 이미 존재하지 않으면 무음 오디오 시작
  if (!getWarmAudio()) {
    try {
      const silentUrl = createSilentWav();
      const audio = new Audio(silentUrl);
      audio.loop = true;
      audio.volume = 0.01; // 거의 무음이지만 0이 아님 (일부 브라우저가 0이면 최적화로 중단)
      audio.play().then(() => {
        setWarmAudio(audio);
        console.log("[AlarmSound] 🔥 Warm audio started (silent loop)");
      }).catch(() => {
        console.warn("[AlarmSound] Warm audio play failed — will retry on next gesture");
      });
    } catch {}
  }

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
    return v ? Math.max(0, Math.min(1, parseFloat(v))) : 0.2;
  } catch { return 0.2; }
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

  // 1. 반복 인터벌 먼저 정지 (현재 + 추적된 모든 인터벌)
  if (refs.interval) {
    clearInterval(refs.interval);
    refs.interval = null;
  }
  clearAllTrackedIntervals();

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

  // 4. GainNode 무음 (AudioContext는 재사용을 위해 유지)
  if (refs.gain) {
    try { refs.gain.gain.value = 0; } catch {}
  }

  // 5. AudioContext는 파기하지 않음 — 모바일에서 새 AudioContext가
  //    suspended 상태로 생성되어 소리가 나지 않는 문제 방지
  //    refs.ctx, refs.gain 유지

  // 6. ★ 추적된 AudioContext는 WebRTC 등 외부 모듈의 것이므로 건드리지 않음
  // 알람 자체 AudioContext(refs.ctx)는 위 4-5단계에서 이미 파기됨
  console.log("[AlarmSound] 🔇 killAllSources: alarm AudioContext destroyed (external contexts preserved)");
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
// Fallback Beep (HTMLAudioElement) — 모바일 AudioContext suspended 대응
// ══════════════════════════════════════
function createFallbackBeep(volume: number): HTMLAudioElement | null {
  try {
    // WAV 헤더 + 간단한 사인파 비프음 생성 (1초, 880Hz)
    const sampleRate = 22050;
    const duration = 1;
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    
    // WAV 헤더
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    
    // 사인파 데이터 (880Hz 비프 + 패턴)
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const freq = t % 0.6 < 0.3 ? 880 : 660; // 교대 주파수
      const envelope = t % 0.6 < 0.5 ? 1 : 0; // 간헐적 비프
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.3 * envelope;
      view.setInt16(44 + i * 2, sample * 32767, true);
    }
    
    const url = arrayBufferToDataUrl(buffer);
    const audio = new Audio(url);
    audio.volume = Math.min(1, volume * 1.5); // 약간 더 크게
    return audio;
  } catch (err) {
    console.warn("[AlarmSound] createFallbackBeep failed:", err);
    return null;
  }
}

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

  // ★★ 모바일 핵심: Warm Audio 우선 사용
  // WebSocket으로 경보 도착 시 사용자 제스처 없이도 소리 가능
  const warmSuccess = await switchWarmToAlarm();
  if (warmSuccess) {
    console.log("[AlarmSound] 🔊 Playing via warm audio (mobile-safe) ✅");
    return;
  }
  console.log("[AlarmSound] ⚠️ Warm audio failed, trying AudioContext/fallback...");

  // 브라우저 정책 대응 — 모바일에서 AudioContext가 suspended일 때
  if (refs.ctx.state === 'suspended') {
    try {
      await refs.ctx.resume();
    } catch {}
    
    if (refs.ctx.state === 'suspended') {
      console.warn("[AlarmSound] AudioContext still suspended — trying HTMLAudio fallback");
      s.pendingPlayGen = myGen;
      
      try {
        const fallbackAudio = createFallbackBeep(volume);
        if (fallbackAudio) {
          refs.customAudio = fallbackAudio;
          fallbackAudio.loop = true;
          await fallbackAudio.play();
          console.log("[AlarmSound] 🔊 Fallback HTMLAudio playing");
          return;
        }
      } catch (fallbackErr) {
        console.warn("[AlarmSound] Fallback audio also failed:", fallbackErr);
      }
      
      if (!s.unlocked) {
        s.isAlarming = false;
        return;
      }
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
  trackInterval(refs.interval!);
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

  // ★ Warm Audio도 무음으로 전환
  switchWarmToSilent();

  // 모든 소스를 동기적으로 즉시 정지
  killAllSources();

  // ★ 이전 버전 오디오 참조도 모두 정리 (v10 등)
  const w = window as unknown as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (key.startsWith('__meercop_audio_') && key !== AUDIO_KEY) {
      const oldRefs = w[key] as Record<string, unknown> | undefined;
      if (!oldRefs || typeof oldRefs !== 'object') continue;
      if (oldRefs.interval != null) { try { clearInterval(oldRefs.interval as ReturnType<typeof setInterval>); } catch {} oldRefs.interval = null; }
      if (Array.isArray(oldRefs.oscillators)) { for (const osc of oldRefs.oscillators as OscillatorNode[]) { try { osc.stop(); } catch {} try { osc.disconnect(); } catch {} } oldRefs.oscillators = []; }
      if (oldRefs.customAudio) { try { (oldRefs.customAudio as HTMLAudioElement).pause(); (oldRefs.customAudio as HTMLAudioElement).src = ''; } catch {} oldRefs.customAudio = null; }
      if (oldRefs.gain) { try { (oldRefs.gain as GainNode).gain.value = 0; } catch {} oldRefs.gain = null; }
      if (oldRefs.ctx) { try { const ctx = oldRefs.ctx as AudioContext; if (ctx.state !== 'closed') { ctx.close().catch(() => {}); } } catch {} oldRefs.ctx = null; }
      try { delete w[key]; } catch {}
    }
  }
  // v10 state도 정리
  const v10State = w['__meercop_alarm_state_v10'] as Record<string, unknown> | undefined;
  if (v10State && typeof v10State === 'object') {
    v10State.isAlarming = false;
    v10State.pendingPlayGen = 0;
  }

  // ★ 추적된 모든 AudioContext도 파기 (클로저에 갇힌 이전 모듈 인스턴스 대응)
  const tracked = getTrackedContexts();
  for (const ctx of tracked) {
    if (ctx && ctx.state !== 'closed') {
      try { ctx.close().catch(() => {}); } catch {}
    }
  }
  tracked.length = 0;

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
// ══════════════════════════════════════
// ★ Preview — 설정 화면 미리듣기 전용 (v2)
// 모바일 핵심: 사용자 제스처 컨텍스트에서 호출되므로
// AudioContext.resume()이 확실히 동작함
// → OscillatorNode 직접 합성을 최우선 사용 (data URL/Blob 불필요)
// ══════════════════════════════════════
let previewTimeout: ReturnType<typeof setTimeout> | null = null;
let previewAudio: HTMLAudioElement | null = null;
let previewCtx: AudioContext | null = null;
let previewOscillators: OscillatorNode[] = [];
let previewGain: GainNode | null = null;
let previewInterval: ReturnType<typeof setInterval> | null = null;

export function preview(soundId?: string, durationMs = 2000, volumeOverride?: number): void {
  // 기존 미리듣기 정지
  stopPreview();

  const volume = volumeOverride ?? getVolume();
  const resolvedSoundId = soundId || getSelectedSoundId();

  console.log("[AlarmSound] 🎵 Preview start:", resolvedSoundId, "vol:", volume, "gesture context");

  // ★ 최우선: AudioContext + OscillatorNode (사용자 제스처 컨텍스트에서 가장 확실)
  // 모바일에서 data URL이나 Blob 없이 직접 합성 → 100% 동작
  try {
    const OrigAC = ((window as unknown as Record<string, unknown>).__meercop_OriginalAudioContext as typeof AudioContext) || AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (OrigAC) {
      previewCtx = new OrigAC();
      // ★ 핵심: 사용자 제스처 내에서 resume() → suspended 해제 보장
      if (previewCtx.state === 'suspended') {
        previewCtx.resume().catch(() => {});
      }
      previewGain = previewCtx.createGain();
      previewGain.connect(previewCtx.destination);
      previewGain.gain.value = Math.min(1, volume * 2);

      const config = ALARM_SOUND_CONFIGS[resolvedSoundId] || ALARM_SOUND_CONFIGS.whistle;
      
      // 즉시 사운드 사이클 재생
      playPreviewCycle(config);
      
      // 반복 재생
      const cycleMs = config.pattern.reduce((a, b) => a + b + 0.05, 0) * 2000 + 300;
      previewInterval = setInterval(() => {
        if (previewCtx && previewCtx.state !== 'closed') {
          playPreviewCycle(config);
        }
      }, cycleMs);
      
      previewTimeout = setTimeout(() => stopPreview(), durationMs);
      console.log("[AlarmSound] 🔊 Preview via direct AudioContext+Oscillator (most reliable on mobile)");
      return;
    }
  } catch (err) {
    console.warn("[AlarmSound] Preview AudioContext failed:", err);
  }

  // ★ Fallback: HTMLAudioElement (짧은 WAV — 1초만, data URL 크기 최소화)
  try {
    const config = ALARM_SOUND_CONFIGS[resolvedSoundId] || ALARM_SOUND_CONFIGS.whistle;
    const sampleRate = 8000; // 최소 샘플레이트 → 작은 data URL
    const duration = 1;
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const w = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true);
    w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, numSamples * 2, true);
    const totalPattern = config.pattern.reduce((a, b) => a + b, 0) + config.pattern.length * 0.05;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const cycleT = t % (totalPattern * 2 + 0.2);
      let freq = config.freq[0];
      let acc = 0;
      for (let fi = 0; fi < config.freq.length; fi++) {
        acc += config.pattern[fi] + 0.05;
        if (cycleT < acc) { freq = config.freq[fi]; break; }
        if (fi === config.freq.length - 1) freq = config.freq[0];
      }
      const gap = cycleT % (config.pattern[0] + 0.05);
      const envelope = gap < config.pattern[0] ? 1 : 0;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.5 * volume * envelope;
      view.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, sample * 32767)), true);
    }
    const url = arrayBufferToDataUrl(buffer);
    previewAudio = new Audio(url);
    previewAudio.volume = Math.min(1, volume * 2);
    previewAudio.play().then(() => {
      console.log("[AlarmSound] 🔊 Preview via fallback HTMLAudio (small WAV)");
    }).catch(err => {
      console.warn("[AlarmSound] Fallback preview also failed:", err);
    });
    previewTimeout = setTimeout(() => stopPreview(), durationMs);
  } catch (err) {
    console.warn("[AlarmSound] All preview methods failed:", err);
  }
}

function playPreviewCycle(soundConfig: { freq: number[]; pattern: number[] }) {
  if (!previewCtx || previewCtx.state === 'closed' || !previewGain) return;
  
  let t = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let i = 0; i < soundConfig.freq.length; i++) {
      try {
        const osc = previewCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = soundConfig.freq[i];
        osc.connect(previewGain);
        osc.start(previewCtx.currentTime + t);
        osc.stop(previewCtx.currentTime + t + soundConfig.pattern[i]);
        previewOscillators.push(osc);
        osc.onended = () => {
          const idx = previewOscillators.indexOf(osc);
          if (idx >= 0) previewOscillators.splice(idx, 1);
        };
      } catch {}
      t += soundConfig.pattern[i] + 0.05;
    }
    t += 0.1;
  }
}

export function stopPreview(): void {
  if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
  if (previewInterval) { clearInterval(previewInterval); previewInterval = null; }
  
  // preview 전용 AudioContext 오실레이터 정지
  for (const osc of previewOscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  previewOscillators = [];
  
  // preview 전용 GainNode 정리
  if (previewGain) {
    try { previewGain.gain.value = 0; } catch {}
    previewGain = null;
  }
  
  // preview 전용 AudioContext 닫기
  if (previewCtx) {
    try { if (previewCtx.state !== 'closed') previewCtx.close().catch(() => {}); } catch {}
    previewCtx = null;
  }
  
  // fallback audio 정지
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
  
  // ★ warm audio는 건드리지 않음! — pause하면 제스처 blessing이 파괴됨
}
}

export type { AlarmState };

// ══════════════════════════════════════
// ★ HMR 클린업 — 모듈 교체 시 이전 인스턴스 자원 완전 해제
// ══════════════════════════════════════
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log("[AlarmSound] 🔥 HMR dispose — cleaning up all audio resources");
    stop();
    killAllSources();
  });
}
