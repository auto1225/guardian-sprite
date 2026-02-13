/**
 * 경보음 모듈 — 모든 상태를 window 전역에 저장
 *
 * PWA 캐시나 HMR로 인한 다중 번들 문제를 방지하기 위해
 * AudioContext, interval, dismissed IDs, suppress 타임스탬프 모두
 * window 전역 객체에 저장하여 어느 번들에서든 동일한 상태에 접근합니다.
 */

interface AlarmGlobal {
  ctx: AudioContext | null;
  iid: ReturnType<typeof setInterval> | null;
  playing: boolean;
  gen: number;
  dismissed: Set<string>;
  suppressUntil: number;
}

function getG(): AlarmGlobal {
  const w = window as any;
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = {
      ctx: null,
      iid: null,
      playing: false,
      gen: 0,
      dismissed: new Set<string>(),
      suppressUntil: 0,
    };
    // dismissed를 localStorage에서 복원
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) w.__meercop_alarm.dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
  }
  // 기존 전역 객체에 dismissed가 누락된 경우 복구
  if (!w.__meercop_alarm.dismissed || !(w.__meercop_alarm.dismissed instanceof Set)) {
    let dismissed = new Set<string>();
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      if (raw) dismissed = new Set(JSON.parse(raw) as string[]);
    } catch {}
    w.__meercop_alarm.dismissed = dismissed;
  }
  return w.__meercop_alarm;
}

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
  if (g.playing || isMuted()) return;

  // 기존 리소스 완전 정리 후 시작
  forceCleanup();

  // playing을 먼저 설정하고 gen을 캡처 (원자적 순서 보장)
  g.playing = true;
  const gen = g.gen;
  console.log("[AlarmSound] ▶ play (gen:", gen, ")");

  try {
    const ctx = new AudioContext();
    await ctx.resume();

    // await 중 stop()이 호출되었는지 확인 (race condition 방지)
    if (!g.playing || g.gen !== gen) {
      try { ctx.close(); } catch {}
      console.log("[AlarmSound] ▶ play aborted (state changed during resume)");
      return;
    }

    g.ctx = ctx;

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
      if (!cur.ctx || cur.ctx.state === 'closed') return;
      if (isMuted()) { stop(); return; }

      // suspended 상태면 resume 후 대기
      if (cur.ctx.state === 'suspended') {
        try { await cur.ctx.resume(); } catch { return; }
        // resume 후 다시 상태 확인
        if (!cur.playing || cur.gen !== gen) return;
      }

      const vol = getVolume();
      const beep = (time: number, freq: number) => {
        try {
          const c = cur.ctx;
          if (!c || c.state === 'closed') return;
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.connect(gain);
          gain.connect(c.destination);
          osc.frequency.value = freq;
          osc.type = "square";
          gain.gain.value = vol;
          osc.start(c.currentTime + time);
          osc.stop(c.currentTime + time + 0.2);
        } catch {}
      };
      beep(0, 880); beep(0.3, 1100); beep(0.6, 880);
      beep(0.9, 1100); beep(1.2, 880); beep(1.5, 1100);
    };

    beepCycle();
    g.iid = setInterval(beepCycle, 2500);
  } catch {
    stop();
  }
}

export function stop() {
  const g = getG();
  const wasPlaying = g.playing;
  g.playing = false;
  g.gen += 1;

  if (g.iid !== null) { clearInterval(g.iid); g.iid = null; }
  if (g.ctx) {
    try { g.ctx.close().catch(() => {}); } catch {}
    g.ctx = null;
  }

  // 실제로 재생 중이었을 때만 로그 (불필요한 stop 로그 제거)
  if (wasPlaying) {
    console.log("[AlarmSound] ■ stop (gen:", g.gen, ")");
  }
}

/** 레거시 리소스까지 포함한 완전 정리 */
function forceCleanup() {
  stop();
  try {
    const w = window as any;
    if (w.__meercop_ivals) {
      for (const id of w.__meercop_ivals) clearInterval(id);
      w.__meercop_ivals = [];
    }
    if (w.__meercop_ctxs) {
      for (const ctx of w.__meercop_ctxs) {
        try { ctx.close?.(); } catch {}
      }
      w.__meercop_ctxs = [];
    }
  } catch {}
}
