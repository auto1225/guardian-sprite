/**
 * 경보음 모듈 v9 — 동기적 오실레이터 추적 & 즉각 정지
 *
 * v9 변경:
 *   1. 모든 OscillatorNode를 전역 레지스트리에 추가 — stop() 시 즉시 .stop() 호출
 *   2. 모든 GainNode를 전역 레지스트리에 추가 — stop() 시 즉시 disconnect()
 *   3. ctx.close()의 비동기 특성에 의존하지 않고 동기적으로 모든 노드를 정지
 *   4. setVolume()이 모든 등록된 GainNode에 즉시 반영
 *
 * 기존 기능 유지:
 *   - 전역 AudioContext 레지스트리
 *   - HMR 대응
 *   - 사용자 설정 경보음 지원
 *   - Pending Play (모바일 자동재생 제한 대응)
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
// 전역 오디오 레지스트리 — 모든 버전 공유
// ══════════════════════════════════════
const REGISTRY_KEY = '__meercop_audio_registry';
const INTERVALS_KEY = '__meercop_all_intervals';
const AUDIOS_KEY = '__meercop_all_audios';
const OSCILLATORS_KEY = '__meercop_all_oscillators';
const GAINS_KEY = '__meercop_all_gains';

function getRegistry(): AudioContext[] {
  const w = window as unknown as Record<string, AudioContext[]>;
  if (!w[REGISTRY_KEY]) w[REGISTRY_KEY] = [];
  return w[REGISTRY_KEY];
}

function getAllIntervals(): ReturnType<typeof setInterval>[] {
  const w = window as unknown as Record<string, ReturnType<typeof setInterval>[]>;
  if (!w[INTERVALS_KEY]) w[INTERVALS_KEY] = [];
  return w[INTERVALS_KEY];
}

function getAllAudios(): HTMLAudioElement[] {
  const w = window as unknown as Record<string, HTMLAudioElement[]>;
  if (!w[AUDIOS_KEY]) w[AUDIOS_KEY] = [];
  return w[AUDIOS_KEY];
}

function getAllOscillators(): OscillatorNode[] {
  const w = window as unknown as Record<string, OscillatorNode[]>;
  if (!w[OSCILLATORS_KEY]) w[OSCILLATORS_KEY] = [];
  return w[OSCILLATORS_KEY];
}

function getAllGains(): GainNode[] {
  const w = window as unknown as Record<string, GainNode[]>;
  if (!w[GAINS_KEY]) w[GAINS_KEY] = [];
  return w[GAINS_KEY];
}

function registerAudioCtx(ctx: AudioContext) { getRegistry().push(ctx); }
function registerInterval(id: ReturnType<typeof setInterval>) { getAllIntervals().push(id); }
function registerAudio(audio: HTMLAudioElement) { getAllAudios().push(audio); }
function registerOscillator(osc: OscillatorNode) { getAllOscillators().push(osc); }
function registerGain(gain: GainNode) { getAllGains().push(gain); }

/** 전역 레지스트리의 모든 오디오를 강제 종료 */
function nukeAllAudio() {
  // 1. 오실레이터 — 동기적으로 즉시 정지
  const oscillators = getAllOscillators();
  for (const osc of oscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  oscillators.length = 0;

  // 2. GainNode — 즉시 0으로 + disconnect
  const gains = getAllGains();
  for (const gain of gains) {
    try { gain.gain.value = 0; } catch {}
    try { gain.disconnect(); } catch {}
  }
  gains.length = 0;

  // 3. AudioContexts — suspend 후 close
  const registry = getRegistry();
  for (const ctx of registry) {
    try { if (ctx.state !== 'closed') ctx.suspend().catch(() => {}); } catch {}
    try { ctx.close(); } catch {}
  }
  registry.length = 0;

  // 4. Intervals
  const intervals = getAllIntervals();
  for (const id of intervals) {
    try { clearInterval(id); } catch {}
  }
  intervals.length = 0;

  // 5. HTML Audio elements
  const audios = getAllAudios();
  for (const audio of audios) {
    try { audio.pause(); audio.currentTime = 0; audio.src = ''; audio.load(); } catch {}
  }
  audios.length = 0;

  // 6. 레거시 전역 객체 정리
  try {
    const w = window as unknown as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(w)) {
      if (!key.startsWith('__meercop_alarm')) continue;
      const old = w[key];
      if (!old || typeof old !== 'object') continue;
      old.isAlarming = false;
      old.pendingPlayGen = 0;
      if (old.audioCtx) try { (old.audioCtx as AudioContext).close(); } catch {}
      if (old.ctx) try { (old.ctx as AudioContext).close(); } catch {}
      if (old.customAudio) try { (old.customAudio as HTMLAudioElement).pause(); } catch {}
      if (Array.isArray(old.intervals)) (old.intervals as ReturnType<typeof setInterval>[]).forEach(id => { try { clearInterval(id as ReturnType<typeof setInterval>); } catch {} });
      if (Array.isArray(old.oscillators)) (old.oscillators as OscillatorNode[]).forEach(o => { try { o.stop(); } catch {} });
      old.intervals = [];
      old.oscillators = [];
      old.audioCtx = null;
      old.masterGain = null;
    }
  } catch {}
}

// 모듈 로드 시 즉시 레거시 정리
nukeAllAudio();

/** 디버그: 현재 살아있는 모든 오디오 소스 상태 보고 */
export function debugAudioSources(): string[] {
  const report: string[] = [];
  const registry = getRegistry();
  report.push(`[Registry] AudioContexts: ${registry.length} (states: ${registry.map(c => c.state).join(', ') || 'none'})`);
  report.push(`[Registry] Intervals: ${getAllIntervals().length}`);
  report.push(`[Registry] HTMLAudios: ${getAllAudios().length} (playing: ${getAllAudios().filter(a => !a.paused).length})`);
  report.push(`[Registry] Oscillators: ${getAllOscillators().length}`);
  report.push(`[Registry] GainNodes: ${getAllGains().length}`);

  const w = window as unknown as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (key.startsWith('__meercop')) {
      const val = w[key];
      if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        report.push(`[Legacy] ${key}: isAlarming=${obj.isAlarming}, intervals=${Array.isArray(obj.intervals) ? (obj.intervals as unknown[]).length : 'N/A'}`);
      } else {
        report.push(`[Legacy] ${key}: ${typeof val}`);
      }
    }
  }

  const s = getState();
  report.push(`[State] isAlarming=${s.isAlarming}, gen=${s.gen}, pendingPlay=${s.pendingPlayGen}, unlocked=${s.unlocked}`);
  report.push(`[State] suppressUntil=${s.suppressUntil > Date.now() ? `${Math.round((s.suppressUntil - Date.now()) / 1000)}s remaining` : 'none'}`);
  report.push(`[State] lastStoppedAt=${s.lastStoppedAt ? `${Math.round((Date.now() - s.lastStoppedAt) / 1000)}s ago` : 'never'}`);

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.getNotifications().then(ns => {
        console.log(`[AudioDebug] Active notifications: ${ns.length}`, ns.map(n => ({ tag: n.tag, title: n.title })));
      });
    }).catch(() => {});
  }

  return report;
}

/** 비상 정지: 모든 가능한 오디오 소스를 강제 종료 */
export function emergencyKillAll(): string[] {
  const report: string[] = [];
  nukeAllAudio();
  report.push("✅ nukeAllAudio() executed");

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
        report.push(`✅ Closed ${ns.length} notifications`);
        console.log("[EmergencyKill] Closed notifications:", ns.length);
      });
    }).catch(() => {});
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => {
        r.unregister();
        report.push(`✅ Unregistered SW: ${r.scope}`);
        console.log("[EmergencyKill] Unregistered SW:", r.scope);
      });
    }).catch(() => {});
  }

  return report;
}

export interface AlarmState {
  isAlarming: boolean;
  gen: number;
  dismissed: Set<string>;
  suppressUntil: number;
  unlocked: boolean;
  pendingPlayGen: number;
  lastStoppedAt: number;
  activeMasterGain: GainNode | null;
}

const STATE_KEY = '__meercop_alarm_state_v6';

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
      activeMasterGain: null,
    };
    try {
      const lst = localStorage.getItem('meercop_last_stopped_at');
      if (lst) w[STATE_KEY].lastStoppedAt = parseInt(lst, 10) || 0;
    } catch {}
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) w[STATE_KEY].dismissed = new Set(JSON.parse(raw) as string[]);
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
// AudioContext 사전 Unlock — 모바일 핵심
// ══════════════════════════════════════

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
  // 재생 중인 HTMLAudioElement 볼륨 즉시 반영
  for (const audio of getAllAudios()) {
    try { audio.volume = clamped; } catch {}
  }
  // 재생 중인 모든 GainNode 볼륨 즉시 반영
  for (const gain of getAllGains()) {
    try { gain.gain.value = clamped; } catch {}
  }
  // activeMasterGain도 업데이트
  const s = getState();
  if (s.activeMasterGain) {
    try { s.activeMasterGain.gain.value = clamped; } catch {}
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
// Core: stopSound — 전역 레지스트리 기반 완전 정지
// ══════════════════════════════════════
function stopSound() {
  nukeAllAudio();
}

// ══════════════════════════════════════
// Core: playSoundCycle — 오실레이터를 레지스트리에 등록
// ══════════════════════════════════════
function playSoundCycle(audioCtx: AudioContext, masterGain: GainNode, soundConfig: { freq: number[]; pattern: number[] }) {
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
      // 🔧 v9: 오실레이터와 게인 노드를 레지스트리에 등록
      registerOscillator(osc);
      registerGain(gain);
    } catch {}
  };

  let t = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let i = 0; i < soundConfig.freq.length; i++) {
      beep(t, soundConfig.freq[i], soundConfig.pattern[i]);
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
    const audio = new Audio(dataUrl);
    audio.volume = volume;
    audio.loop = true;
    registerAudio(audio);

    audio.play().catch((err) => {
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

  if (isSuppressed()) {
    console.log("[AlarmSound] play() blocked — suppressed for",
      Math.round((s.suppressUntil - Date.now()) / 1000), "s more");
    return;
  }

  const timeSinceStop = Date.now() - s.lastStoppedAt;
  if (s.lastStoppedAt > 0 && timeSinceStop < 3000) {
    console.log("[AlarmSound] play() blocked — stopped",
      Math.round(timeSinceStop / 1000), "s ago (3s cooldown)");
    return;
  }

  // 기존 사운드 완전 정리
  stopSound();

  s.isAlarming = true;
  const myGen = ++s.gen;
  const soundId = getSelectedSoundId();
  const volume = getVolume();
  console.log("[AlarmSound] ▶ play (gen:", myGen, "sound:", soundId, "vol:", volume, ")");

  // 커스텀 사운드 처리
  if (soundId === 'custom') {
    if (playCustomSound(volume)) {
      console.log("[AlarmSound] 🎵 Playing custom sound");
      return;
    }
    console.log("[AlarmSound] ⚠️ Custom sound not found, falling back to whistle");
  }

  // 내장 사운드 재생
  const soundConfig = ALARM_SOUND_CONFIGS[soundId] || ALARM_SOUND_CONFIGS.whistle;

  try {
    const audioCtx = new AudioContext();
    registerAudioCtx(audioCtx);

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
    s.activeMasterGain = masterGain;
    registerGain(masterGain);

    if (audioCtx.state === 'suspended') {
      if (!s.unlocked) {
        console.warn("[AlarmSound] AudioContext suspended, no unlock — queuing for next touch");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        try { audioCtx.close(); } catch {}
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
          return;
        }
      } catch {
        console.warn("[AlarmSound] Resume failed — queuing for next touch");
        s.isAlarming = false;
        s.pendingPlayGen = myGen;
        try { audioCtx.close(); } catch {}
        return;
      }
    }

    if (s.gen !== myGen) {
      console.log("[AlarmSound] play aborted (gen changed)");
      try { audioCtx.close(); } catch {}
      return;
    }

    if (isSuppressed()) {
      console.log("[AlarmSound] play aborted after async — suppressed");
      s.isAlarming = false;
      try { audioCtx.close(); } catch {}
      return;
    }

    playSoundCycle(audioCtx, masterGain, soundConfig);

    const cycleLength = soundConfig.pattern.reduce((a, b) => a + b + 0.05, 0) * 2 + 0.3;
    const intervalMs = Math.max(2000, cycleLength * 1000 + 500);

    const intervalId = setInterval(() => {
      if (!s.isAlarming || s.gen !== myGen) {
        clearInterval(intervalId);
        return;
      }

      if (audioCtx.state === 'closed') {
        clearInterval(intervalId);
        s.isAlarming = false;
        return;
      }

      if (isMuted()) {
        stop();
        return;
      }

      if (isSuppressed()) {
        console.log("[AlarmSound] interval stopped — suppressed");
        clearInterval(intervalId);
        s.isAlarming = false;
        try { audioCtx.close(); } catch {}
        return;
      }

      playSoundCycle(audioCtx, masterGain, soundConfig);
    }, intervalMs);

    registerInterval(intervalId);

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

  // 🔧 v9: activeMasterGain 즉시 무음화 + disconnect
  if (s.activeMasterGain) {
    try { s.activeMasterGain.gain.value = 0; } catch {}
    try { s.activeMasterGain.disconnect(); } catch {}
  }
  s.activeMasterGain = null;

  // 🔧 v9: stop() 호출 시 최소 3초간 자동 suppress
  const minSuppressUntil = Date.now() + 3000;
  if (s.suppressUntil < minSuppressUntil) {
    s.suppressUntil = minSuppressUntil;
  }

  // 🔧 v9: 전역 레지스트리를 통해 모든 오실레이터/게인/오디오 즉시 정지
  stopSound();

  // 시스템 푸시 알림도 함께 닫기
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.getNotifications().then(notifications => {
          notifications.forEach(n => {
            if (!n.tag || n.tag.startsWith('meercop')) {
              n.close();
            }
          });
        });
      }).catch(() => {});
    }
  } catch {}

  if (wasAlarming) {
    console.log("[AlarmSound] ■ stop (gen:", s.gen, "auto-suppress 3s)");
  }
}
