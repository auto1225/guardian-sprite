/**
 * 경보음 모듈 v7 — 전역 AudioContext 레지스트리 기반
 *
 * v7 변경 (버그 수정):
 *   1. play()에 isSuppressed() 체크 추가 — 해제 후 재트리거 차단
 *   2. play()에 lastStoppedAt 쿨다운 추가 — stop 직후 재생 방지
 *   3. stop()에서 suppressFor 자동 적용 — 어떤 경로로든 stop하면 3초간 재생 차단
 *
 * 기존 v6 기능 유지:
 *   - 모든 AudioContext를 전역 배열 __meercop_audio_registry에 등록
 *   - stop() 시 레지스트리의 모든 AudioContext를 강제 종료
 *   - HMR 모듈 교체 시에도 이전 모듈의 오디오를 확실히 종료
 *   - 사용자 설정 경보음 지원
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

function registerAudioCtx(ctx: AudioContext) {
  getRegistry().push(ctx);
}

function registerInterval(id: ReturnType<typeof setInterval>) {
  getAllIntervals().push(id);
}

function registerAudio(audio: HTMLAudioElement) {
  getAllAudios().push(audio);
}

/** 전역 레지스트리의 모든 오디오를 강제 종료 */
function nukeAllAudio() {
  // AudioContexts — 🔧 FIX v8: suspend 후 close (모바일에서 즉각 무음화)
  const registry = getRegistry();
  for (const ctx of registry) {
    try {
      if (ctx.state !== 'closed') {
        // suspend()는 동기적으로 오디오 프로세싱을 중단
        ctx.suspend().catch(() => {});
      }
    } catch {}
    try { ctx.close(); } catch {}
  }
  registry.length = 0;

  // Intervals
  const intervals = getAllIntervals();
  for (const id of intervals) {
    try { clearInterval(id); } catch {}
  }
  intervals.length = 0;

  // HTML Audio elements — 🔧 FIX v8: load() 호출로 버퍼 강제 해제
  const audios = getAllAudios();
  for (const audio of audios) {
    try { audio.pause(); audio.currentTime = 0; audio.src = ''; audio.load(); } catch {}
  }
  audios.length = 0;

  // 레거시 전역 객체도 정리
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
  
  // 1. 전역 레지스트리
  const registry = getRegistry();
  report.push(`[Registry] AudioContexts: ${registry.length} (states: ${registry.map(c => c.state).join(', ') || 'none'})`);
  report.push(`[Registry] Intervals: ${getAllIntervals().length}`);
  report.push(`[Registry] HTMLAudios: ${getAllAudios().length} (playing: ${getAllAudios().filter(a => !a.paused).length})`);
  
  // 2. 레거시 전역 객체
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

  // 3. AlarmState
  const s = getState();
  report.push(`[State] isAlarming=${s.isAlarming}, gen=${s.gen}, pendingPlay=${s.pendingPlayGen}, unlocked=${s.unlocked}`);
  report.push(`[State] suppressUntil=${s.suppressUntil > Date.now() ? `${Math.round((s.suppressUntil - Date.now()) / 1000)}s remaining` : 'none'}`);
  report.push(`[State] lastStoppedAt=${s.lastStoppedAt ? `${Math.round((Date.now() - s.lastStoppedAt) / 1000)}s ago` : 'never'}`);
  
  // 4. Service Worker 알림 확인
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
  
  // 1. 전역 레지스트리 nuke
  nukeAllAudio();
  report.push("✅ nukeAllAudio() executed");
  
  // 2. 모든 window 키 중 meercop 관련 삭제
  const w = window as unknown as Record<string, unknown>;
  let deleted = 0;
  for (const key of Object.keys(w)) {
    if (key.startsWith('__meercop')) {
      try { delete w[key]; deleted++; } catch {}
    }
  }
  report.push(`✅ Deleted ${deleted} __meercop* globals`);
  
  // 3. 서비스 워커 알림 닫기
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.getNotifications().then(ns => {
        ns.forEach(n => n.close());
        report.push(`✅ Closed ${ns.length} notifications`);
        console.log("[EmergencyKill] Closed notifications:", ns.length);
      });
    }).catch(() => {});
  }
  
  // 4. 서비스 워커 자체를 unregister (캐시된 old SW 제거)
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
  // 재생 중인 HTMLAudioElement 볼륨 즉시 반영
  for (const audio of getAllAudios()) {
    try { audio.volume = clamped; } catch {}
  }
  // 재생 중인 내장 사운드(WebAudio) 볼륨 즉시 반영
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
// Core: playSoundCycle
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

  // ══════════════════════════════════════
  // 🔧 FIX v7: suppress/cooldown 체크 추가
  // 이전 버전에서는 isSuppressed()와 lastStoppedAt를 play()에서
  // 체크하지 않아서, usePhotoReceiver 등 외부에서 직접 play()를
  // 호출하면 해제 후에도 경보음이 다시 재생되는 버그가 있었음
  // ══════════════════════════════════════
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
  // ══════════════════════════════════════

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

    // 🔧 FIX v7: async 대기 후 suppress 재확인
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

      // 🔧 FIX v7: 반복 재생 중에도 suppress 체크
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

  // 🔧 FIX v8: masterGain을 즉시 0으로 + disconnect → 비동기 close 전에 즉각 무음화
  if (s.activeMasterGain) {
    try { s.activeMasterGain.gain.value = 0; } catch {}
    try { s.activeMasterGain.disconnect(); } catch {}
  }
  s.activeMasterGain = null;

  // 🔧 FIX v7: stop() 호출 시 최소 3초간 자동 suppress
  const minSuppressUntil = Date.now() + 3000;
  if (s.suppressUntil < minSuppressUntil) {
    s.suppressUntil = minSuppressUntil;
  }

  // 전역 레지스트리를 통해 모든 오디오 강제 종료
  stopSound();

  // 시스템 푸시 알림도 함께 닫기 (모든 태그)
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
