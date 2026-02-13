/**
 * 경보음 모듈 v3 — 랩탑 useAlarmSystem.ts 패턴 기반 재작성
 *
 * 핵심 원칙 (랩탑 검증 패턴):
 *   1. stopSound()를 항상 play 전에 호출 — 고아 리소스 원천 차단
 *   2. isAlarming 플래그로 중복 오실레이터 생성 방지
 *   3. stop 시 오실레이터/인터벌 모두 배열로 추적하여 완전 정리
 *   4. 모든 상태를 window 전역에 저장 — 다중 번들 안전
 */

// ── 전역 상태 타입 ──
interface AlarmState {
  /** 현재 경보 중 여부 */
  isAlarming: boolean;
  /** 활성 오실레이터 목록 */
  oscillators: OscillatorNode[];
  /** 활성 인터벌 목록 */
  intervals: ReturnType<typeof setInterval>[];
  /** AudioContext (하나만 유지) */
  audioCtx: AudioContext | null;
  /** 해제된 경보 ID */
  dismissed: Set<string>;
  /** 일시 억제 타임스탬프 */
  suppressUntil: number;
}

const GLOBAL_KEY = '__meercop_alarm_v3';

function getState(): AlarmState {
  const w = window as any;
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = {
      isAlarming: false,
      oscillators: [],
      intervals: [],
      audioCtx: null,
      dismissed: new Set<string>(),
      suppressUntil: 0,
    };
    // dismissed를 localStorage에서 복원
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) w[GLOBAL_KEY].dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
  }
  const s = w[GLOBAL_KEY] as AlarmState;
  // dismissed가 누락된 경우 복구
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

// ── 모듈 로드 시 레거시 전역 정리 ──
(function cleanupLegacy() {
  try {
    const w = window as any;
    // v1
    if (w.__meercop_alarm) {
      if (w.__meercop_alarm.iid) clearInterval(w.__meercop_alarm.iid);
      if (w.__meercop_alarm.ctx) try { w.__meercop_alarm.ctx.close(); } catch {}
      delete w.__meercop_alarm;
    }
    // v2
    if (w.__meercop_alarm2) {
      const v2 = w.__meercop_alarm2;
      if (Array.isArray(v2.iids)) v2.iids.forEach((id: any) => { try { clearInterval(id); } catch {} });
      if (Array.isArray(v2.ctxs)) v2.ctxs.forEach((c: any) => { try { c.close(); } catch {} });
      delete w.__meercop_alarm2;
    }
    // 기타 레거시
    if (w.__meercop_ivals) { w.__meercop_ivals.forEach((id: any) => clearInterval(id)); delete w.__meercop_ivals; }
    if (w.__meercop_ctxs) { w.__meercop_ctxs.forEach((c: any) => { try { c.close(); } catch {} }); delete w.__meercop_ctxs; }
  } catch {}
})();

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
// Core: stopSound — 랩탑 패턴 그대로
// 모든 오실레이터, 인터벌, AudioContext 완전 정리
// ══════════════════════════════════════
function stopSound() {
  const s = getState();

  // 1. 모든 인터벌 정리
  for (const iid of s.intervals) {
    try { clearInterval(iid); } catch {}
  }
  s.intervals = [];

  // 2. 모든 오실레이터 정리
  for (const osc of s.oscillators) {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
  }
  s.oscillators = [];

  // 3. AudioContext 정리
  if (s.audioCtx) {
    try { s.audioCtx.close().catch(() => {}); } catch {}
    s.audioCtx = null;
  }
}

// ══════════════════════════════════════
// Core: playAlarmSound — 랩탑 패턴 기반
// 항상 stopSound() 호출 후 새 사운드 생성
// ══════════════════════════════════════
function playAlarmSound(audioCtx: AudioContext, volume: number): OscillatorNode[] {
  const createdOscillators: OscillatorNode[] = [];

  const beep = (time: number, freq: number) => {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.value = volume;
      osc.start(audioCtx.currentTime + time);
      osc.stop(audioCtx.currentTime + time + 0.2);
      createdOscillators.push(osc);
    } catch {}
  };

  // 경보 패턴: 6비프 (880Hz/1100Hz 교대, 1.8초)
  beep(0, 880);
  beep(0.3, 1100);
  beep(0.6, 880);
  beep(0.9, 1100);
  beep(1.2, 880);
  beep(1.5, 1100);

  return createdOscillators;
}

// ══════════════════════════════════════
// Public API
// ══════════════════════════════════════
export function isPlaying(): boolean {
  return getState().isAlarming;
}

/**
 * 경보음 시작 — 랩탑의 startAlarm() 패턴
 * 이미 alarming이면 중복 생성 방지
 */
export async function play() {
  const s = getState();

  // 핵심 가드: 이미 경보 중이면 무시 (중복 오실레이터 방지)
  if (s.isAlarming) {
    console.log("[AlarmSound] play() skipped — already alarming");
    return;
  }

  if (isMuted()) return;

  // 1. 항상 기존 사운드 완전 정리 (랩탑 패턴)
  stopSound();

  // 2. isAlarming 설정 (이후 중복 호출 차단)
  s.isAlarming = true;
  console.log("[AlarmSound] ▶ play");

  try {
    // 3. 새 AudioContext 생성
    const audioCtx = new AudioContext();
    
    // 모바일: suspended 상태면 resume
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // await 중 stop()이 호출되었는지 확인
    if (!s.isAlarming) {
      try { audioCtx.close(); } catch {}
      console.log("[AlarmSound] play aborted (stopped during resume)");
      return;
    }

    s.audioCtx = audioCtx;

    // 4. 모바일 AudioContext suspend 방지용 무음 유지
    try {
      const keepAlive = audioCtx.createGain();
      keepAlive.gain.value = 0;
      const silentOsc = audioCtx.createOscillator();
      silentOsc.frequency.value = 0;
      silentOsc.connect(keepAlive);
      keepAlive.connect(audioCtx.destination);
      silentOsc.start();
      s.oscillators.push(silentOsc);
    } catch {}

    // 5. 첫 비프 사이클 즉시 실행
    const vol = getVolume();
    const newOscs = playAlarmSound(audioCtx, vol);
    s.oscillators.push(...newOscs);

    // 6. 2.5초 간격 반복
    const intervalId = setInterval(() => {
      const cur = getState();
      if (!cur.isAlarming || !cur.audioCtx || cur.audioCtx.state === 'closed') {
        clearInterval(intervalId);
        return;
      }
      if (isMuted()) {
        stop();
        return;
      }

      // suspended면 resume 시도
      if (cur.audioCtx.state === 'suspended') {
        cur.audioCtx.resume().catch(() => {});
      }

      const v = getVolume();
      const oscs = playAlarmSound(cur.audioCtx, v);
      cur.oscillators.push(...oscs);

      // 오래된 오실레이터 정리 (ended 상태인 것들)
      cur.oscillators = cur.oscillators.filter(o => {
        try {
          // ended 상태의 OscillatorNode는 context에서 분리
          if ((o as any).playbackState === 3 || (o as any).context?.state === 'closed') {
            try { o.disconnect(); } catch {}
            return false;
          }
        } catch {}
        return true;
      });
    }, 2500);

    s.intervals.push(intervalId);

  } catch (err) {
    console.error("[AlarmSound] play error:", err);
    stop();
  }
}

/**
 * 경보음 중지 — 랩탑의 stopAlarm() 패턴
 * stopSound() + 상태 초기화
 */
export function stop() {
  const s = getState();
  const wasAlarming = s.isAlarming;

  // 1. 상태 먼저 해제 (다른 호출이 중복 진입하지 않도록)
  s.isAlarming = false;

  // 2. 모든 리소스 정리
  stopSound();

  if (wasAlarming) {
    console.log("[AlarmSound] ■ stop");
  }
}
