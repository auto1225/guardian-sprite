/**
 * 경보음 모듈 — window 전역 싱글톤
 *
 * 문제: Vite HMR이나 PWA 캐시로 인해 여러 JS 번들이 동시에 로드되면
 *       각 번들이 독립된 AudioContext/interval을 가져 한쪽만 stop해도
 *       다른쪽이 계속 울림.
 *
 * 해결: 모든 오디오 상태를 window.__meercop_alarm에 저장하여
 *       어떤 번들에서 stop()을 호출해도 동일한 리소스를 정리함.
 */

interface AlarmGlobal {
  ctx: AudioContext | null;
  iid: ReturnType<typeof setInterval> | null;
  playing: boolean;
  gen: number; // generation — stop 시 증가하여 진행중 beep 루프 중단
}

function getG(): AlarmGlobal {
  const w = window as any;
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = { ctx: null, iid: null, playing: false, gen: 0 };
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

// ── Dismissed IDs (window 전역 공유) ──
function getDismissedIds(): Set<string> {
  const w = window as any;
  if (!w.__meercop_dismissed) {
    try {
      const raw = localStorage.getItem('meercop_dismissed_ids');
      w.__meercop_dismissed = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      w.__meercop_dismissed = new Set();
    }
  }
  return w.__meercop_dismissed;
}

function saveDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem('meercop_dismissed_ids', JSON.stringify(Array.from(ids).slice(-50)));
  } catch {}
}

export function isDismissed(alertId: string): boolean { return getDismissedIds().has(alertId); }

export function addDismissed(alertId: string) {
  const ids = getDismissedIds();
  ids.add(alertId);
  saveDismissedIds(ids);
}

// ── Suppress (window 전역 공유) ──
export function isSuppressed(): boolean {
  return Date.now() < ((window as any).__meercop_suppress_until || 0);
}
export function suppressFor(ms: number) {
  (window as any).__meercop_suppress_until = Date.now() + ms;
}

// ── 볼륨 ──
export function getVolume(): number {
  try {
    const v = localStorage.getItem('meercop_alarm_volume');
    return v ? Math.max(0, Math.min(1, parseFloat(v))) : 0.4;
  } catch { return 0.4; }
}

export function setVolume(vol: number) {
  try { localStorage.setItem('meercop_alarm_volume', String(Math.max(0, Math.min(1, vol)))); } catch {}
}

// ── 재생/정지 ──
export function isPlaying(): boolean { return getG().playing; }

export function play() {
  const g = getG();
  if (g.playing) return;
  if (isMuted()) return;

  // 기존 리소스 완전 정리 후 시작
  stop();

  const gen = g.gen;
  g.playing = true;
  console.log("[AlarmSound] ▶ Start (gen:", gen, ")");

  try {
    const ctx = new AudioContext();
    g.ctx = ctx;

    const beepCycle = () => {
      const current = getG();
      if (!current.playing || current.gen !== gen || !current.ctx || current.ctx.state === 'closed') {
        return;
      }
      if (isMuted()) { stop(); return; }

      const vol = getVolume();
      const beep = (time: number, freq: number) => {
        try {
          const c = current.ctx;
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
  g.playing = false;
  g.gen += 1; // 진행중 beep 루프 강제 중단

  if (g.iid !== null) {
    clearInterval(g.iid);
    g.iid = null;
  }

  if (g.ctx) {
    try { g.ctx.suspend().catch(() => {}); g.ctx.close().catch(() => {}); } catch {}
    g.ctx = null;
  }

  // 구 코드가 남긴 레거시 전역 리소스도 정리
  try {
    const w = window as any;
    if (w.__meercop_ivals) {
      for (const id of w.__meercop_ivals) clearInterval(id);
      w.__meercop_ivals = [];
    }
    if (w.__meercop_ctxs) {
      for (const ctx of w.__meercop_ctxs) {
        try { ctx.suspend?.(); ctx.close?.(); } catch {}
      }
      w.__meercop_ctxs = [];
    }
  } catch {}

  console.log("[AlarmSound] ■ Stop (gen:", g.gen, ")");
}
