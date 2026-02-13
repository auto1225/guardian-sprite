/**
 * 경보음 모듈 — 모든 상태를 window 전역에 저장
 *
 * PWA 캐시나 HMR로 인한 다중 번들 문제를 방지하기 위해
 * AudioContext, interval, dismissed IDs, suppress 타임스탬프 모두
 * window 전역 객체에 저장하여 어느 번들에서든 동일한 상태에 접근합니다.
 *
 * 핵심: 모든 AudioContext와 interval을 배열로 관리하여
 * 다중 번들에서 동시 play() 호출 시 고아(orphan) 리소스를 방지합니다.
 */

interface AlarmGlobal {
  ctxs: AudioContext[];        // 모든 생성된 AudioContext 추적
  iids: ReturnType<typeof setInterval>[];  // 모든 interval 추적
  playing: boolean;
  gen: number;
  dismissed: Set<string>;
  suppressUntil: number;
  playLock: boolean;           // 동시 play() 호출 방지 락
}

function getG(): AlarmGlobal {
  const w = window as any;
  if (!w.__meercop_alarm2) {
    w.__meercop_alarm2 = {
      ctxs: [],
      iids: [],
      playing: false,
      gen: 0,
      dismissed: new Set<string>(),
      suppressUntil: 0,
      playLock: false,
    };
    // dismissed를 localStorage에서 복원
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) w.__meercop_alarm2.dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
  }
  const g = w.__meercop_alarm2;
  // 기존 전역 객체에 dismissed가 누락된 경우 복구
  if (!g.dismissed || !(g.dismissed instanceof Set)) {
    let dismissed = new Set<string>();
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
    g.dismissed = dismissed;
  }
  // 배열 필드가 누락된 경우 복구 (v1 → v2 마이그레이션)
  if (!Array.isArray(g.ctxs)) g.ctxs = [];
  if (!Array.isArray(g.iids)) g.iids = [];
  return g;
}

// ── 레거시 v1 전역 상태 정리 ──
function cleanupLegacyGlobal() {
  try {
    const w = window as any;
    // v1 전역 상태 정리
    if (w.__meercop_alarm) {
      const old = w.__meercop_alarm;
      if (old.iid) { try { clearInterval(old.iid); } catch {} }
      if (old.ctx) { try { old.ctx.close(); } catch {} }
      delete w.__meercop_alarm;
    }
    // 레거시 리소스 정리
    if (w.__meercop_ivals) {
      for (const id of w.__meercop_ivals) { try { clearInterval(id); } catch {} }
      w.__meercop_ivals = [];
    }
    if (w.__meercop_ctxs) {
      for (const ctx of w.__meercop_ctxs) { try { ctx.close?.(); } catch {} }
      w.__meercop_ctxs = [];
    }
  } catch {}
}

// 모듈 로드 시 레거시 정리
cleanupLegacyGlobal();

// ── Mute ──
export function isMuted(): boolean {
  try { return localStorage.getItem('meercop_alarm_muted') === 'true'; } catch { return false; }
}

export function setMuted(muted: boolean) {
  try { localStorage.setItem('meercop_alarm_muted', String(muted)); } catch {}
  if (muted) stop();
}

// ── Dismissed ──
export function isDismissed(alertId: string): boolean {
  return getG().dismissed.has(alertId);
}

export function addDismissed(alertId: string) {
  const g = getG();
  g.dismissed.add(alertId);
  try {
    localStorage.setItem('meercop_dismissed_ids',
      JSON.stringify(Array.from(g.dismissed).slice(-50)));
  } catch {}
}

// ── Suppress ──
export function isSuppressed(): boolean {
  return Date.now() < getG().suppressUntil;
}

export function suppressFor(ms: number) {
  getG().suppressUntil = Date.now() + ms;
}

// ── Volume ──
export function getVolume(): number {
  try {
    const v = localStorage.getItem('meercop_alarm_volume');
    return v ? Math.max(0, Math.min(1, parseFloat(v))) : 0.4;
  } catch { return 0.4; }
}

export function setVolume(vol: number) {
  try { localStorage.setItem('meercop_alarm_volume', String(Math.max(0, Math.min(1, vol)))); } catch {}
}

// ── Play / Stop ──
export function isPlaying(): boolean { return getG().playing; }

export async function play() {
  const g = getG();

  // 이미 재생 중이거나 뮤트 상태면 무시
  if (g.playing || isMuted()) return;

  // 동시 play() 호출 방지 (다중 번들 race condition)
  if (g.playLock) {
    console.log("[AlarmSound] play() skipped (lock active)");
    return;
  }
  g.playLock = true;

  try {
    // 모든 기존 리소스 완전 정리
    stopAll();

    g.playing = true;
    const gen = g.gen;
    console.log("[AlarmSound] ▶ play (gen:", gen, ")");

    const ctx = new AudioContext();
    await ctx.resume();

    // await 중 stop()이 호출되었는지 확인
    if (!g.playing || g.gen !== gen) {
      try { ctx.close(); } catch {}
      console.log("[AlarmSound] ▶ play aborted (state changed during resume)");
      return;
    }

    // AudioContext를 전역 배열에 등록 (어느 번들에서든 정리 가능)
    g.ctxs.push(ctx);

    // 모바일에서 AudioContext 자동 suspend 방지용 무음 유지
    try {
      const keepAlive = ctx.createGain();
      keepAlive.gain.value = 0.001;
      const silentOsc = ctx.createOscillator();
      silentOsc.frequency.value = 1;
      silentOsc.connect(keepAlive);
      keepAlive.connect(ctx.destination);
      silentOsc.start();
    } catch {}

    const beepCycle = async () => {
      const cur = getG();
      if (!cur.playing || cur.gen !== gen) return;
      if (ctx.state === 'closed') return;
      if (isMuted()) { stop(); return; }

      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { return; }
        if (!cur.playing || cur.gen !== gen) return;
      }

      const vol = getVolume();
      const beep = (time: number, freq: number) => {
        try {
          if (ctx.state === 'closed') return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "square";
          gain.gain.value = vol;
          osc.start(ctx.currentTime + time);
          osc.stop(ctx.currentTime + time + 0.2);
        } catch {}
      };
      beep(0, 880); beep(0.3, 1100); beep(0.6, 880);
      beep(0.9, 1100); beep(1.2, 880); beep(1.5, 1100);
    };

    beepCycle();
    const iid = setInterval(beepCycle, 2500);
    g.iids.push(iid);
  } catch {
    stop();
  } finally {
    g.playLock = false;
  }
}

/** 모든 AudioContext와 interval을 정리 */
function stopAll() {
  const g = getG();

  // 모든 interval 정리
  for (const iid of g.iids) {
    try { clearInterval(iid); } catch {}
  }
  g.iids = [];

  // 모든 AudioContext 정리
  for (const ctx of g.ctxs) {
    try { ctx.close().catch(() => {}); } catch {}
  }
  g.ctxs = [];

  // 레거시 정리도 수행
  cleanupLegacyGlobal();
}

export function stop() {
  const g = getG();
  const wasPlaying = g.playing;
  g.playing = false;
  g.gen += 1;

  stopAll();

  if (wasPlaying) {
    console.log("[AlarmSound] ■ stop (gen:", g.gen, ")");
  }
}
