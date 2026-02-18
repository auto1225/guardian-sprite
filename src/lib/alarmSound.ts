/**
 * 경보음 모듈 v10 — 단일 AudioContext + 영속 GainNode 아키텍처
 *
 * 핵심 구조:
 *   Source(Oscillator) → GainNode → Destination(스피커)
 *   - AudioContext와 GainNode는 한 번만 생성, 재사용
 *   - Oscillator는 재생 시 생성, 정지 시 .stop() + .disconnect()
 *   - 볼륨은 GainNode.gain으로 즉시 반영
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
// 전역 상태 — 함수 밖에서 선언 (핵심!)
// ══════════════════════════════════════
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let activeOscillators: OscillatorNode[] = [];
let activeInterval: ReturnType<typeof setInterval> | null = null;
let customAudioEl: HTMLAudioElement | null = null;

// ══════════════════════════════════════
// 레거시 전역 레지스트리 정리 (HMR / 이전 버전 대응)
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

  // 레거시 __meercop_alarm* 전역 객체
  for (const key of Object.keys(w)) {
    if (!key.startsWith('__meercop_alarm')) continue;
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

const STATE_KEY = '__meercop_alarm_state_v10';

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
// AudioContext 초기화 — 한 번만 생성
// ══════════════════════════════════════
function initAudio() {
  if (audioCtx && audioCtx.state !== 'closed') return;

  audioCtx = new AudioContext();
  gainNode = audioCtx.createGain();
  gainNode.connect(audioCtx.destination);
  gainNode.gain.value = getVolume();
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
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    // 무음 버퍼 재생으로 unlock 확인
    if (audioCtx) {
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
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
// Volume — GainNode에 즉시 반영
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
  // GainNode에 즉시 반영 — 부드러운 전환으로 '퍽' 소리 방지
  if (gainNode && audioCtx && audioCtx.state !== 'closed') {
    gainNode.gain.setTargetAtTime(clamped, audioCtx.currentTime, 0.01);
  }
  // 커스텀 HTMLAudioElement 볼륨도 반영
  if (customAudioEl) {
    try { customAudioEl.volume = clamped; } catch {}
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
// 모든 소스 정지 (동기적)
// ══════════════════════════════════════
function killAllSources() {
  // 1. 오실레이터 즉시 정지
  for (const osc of activeOscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  activeOscillators = [];

  // 2. 반복 인터벌 정지
  if (activeInterval) {
    clearInterval(activeInterval);
    activeInterval = null;
  }

  // 3. 커스텀 오디오 정지
  if (customAudioEl) {
    try { customAudioEl.pause(); customAudioEl.currentTime = 0; customAudioEl.src = ''; customAudioEl.load(); } catch {}
    customAudioEl = null;
  }

  // 4. GainNode 즉시 무음 (연결은 유지 — 재사용을 위해)
  if (gainNode) {
    try { gainNode.gain.value = 0; } catch {}
  }
}

// ══════════════════════════════════════
// Core: playSoundCycle — 오실레이터 생성 & 추적
// ══════════════════════════════════════
function playSoundCycle(soundConfig: { freq: number[]; pattern: number[] }) {
  if (!audioCtx || audioCtx.state === 'closed' || !gainNode) return;

  let t = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let i = 0; i < soundConfig.freq.length; i++) {
      try {
        const osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = soundConfig.freq[i];
        // Source → GainNode (→ 이미 destination에 연결됨)
        osc.connect(gainNode);
        osc.start(audioCtx.currentTime + t);
        osc.stop(audioCtx.currentTime + t + soundConfig.pattern[i]);
        // 추적 등록 — stop() 시 즉시 정지 가능
        activeOscillators.push(osc);
        // 자연 종료 시 배열에서 제거 (메모리 정리)
        osc.onended = () => {
          const idx = activeOscillators.indexOf(osc);
          if (idx >= 0) activeOscillators.splice(idx, 1);
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
    customAudioEl = new Audio(dataUrl);
    customAudioEl.volume = volume;
    customAudioEl.loop = true;
    customAudioEl.play().catch((err) => {
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

  // AudioContext 초기화 (재사용)
  initAudio();
  if (!audioCtx || !gainNode) {
    s.isAlarming = false;
    return;
  }

  // 볼륨 설정
  gainNode.gain.value = volume;

  // 브라우저 정책 대응
  if (audioCtx.state === 'suspended') {
    if (!s.unlocked) {
      console.warn("[AlarmSound] AudioContext suspended, no unlock — queuing");
      s.isAlarming = false;
      s.pendingPlayGen = myGen;
      return;
    }
    try {
      await audioCtx.resume();
      if (audioCtx.state === 'suspended') {
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

  activeInterval = setInterval(() => {
    if (!s.isAlarming || s.gen !== myGen) {
      if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
      return;
    }
    if (isMuted() || isSuppressed()) {
      stop();
      return;
    }
    if (audioCtx && audioCtx.state === 'closed') {
      if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
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

  // 🔑 핵심: 모든 소스를 동기적으로 즉시 정지
  killAllSources();

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
  report.push(`[AudioCtx] state: ${audioCtx?.state ?? 'null'}`);
  report.push(`[GainNode] value: ${gainNode?.gain?.value ?? 'null'}`);
  report.push(`[Oscillators] active: ${activeOscillators.length}`);
  report.push(`[Interval] active: ${activeInterval !== null}`);
  report.push(`[CustomAudio] playing: ${customAudioEl ? !customAudioEl.paused : false}`);
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

  // AudioContext도 완전히 닫기 (재생성 됨)
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close().catch(() => {});
    audioCtx = null;
    gainNode = null;
    report.push("✅ AudioContext closed");
  }

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
// re-export for compatibility (AlarmState는 내부 사용)
// ══════════════════════════════════════
export type { AlarmState };
