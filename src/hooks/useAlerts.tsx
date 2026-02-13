import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { 
  addActivityLog, 
  getAlertLogs, 
  markLogAsRead, 
  markAllLogsAsRead,
  LocalActivityLog,
  LocalAlertType 
} from "@/lib/localActivityLogs";

// ── 전역 경보음 상태 (window에 저장하여 HMR 시에도 추적 가능) ──
interface AlarmState {
  generation: number;       // 매 stop마다 증가 → 좀비 루프 자동 중단
  playing: boolean;
  dismissedIds: Set<string>;
  lastPlayedId: string | null;
  muted: boolean;
  suppressUntil: number;    // dismiss 후 일시적으로 새 알람 차단 (timestamp)
}

/** localStorage에서 dismissedIds 복원 */
function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem('meercop_dismissed_ids');
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch {}
  return new Set();
}

/** dismissedIds를 localStorage에 저장 (최대 50개) */
function saveDismissedIds(ids: Set<string>) {
  try {
    const arr = Array.from(ids).slice(-50); // 최근 50개만 유지
    localStorage.setItem('meercop_dismissed_ids', JSON.stringify(arr));
  } catch {}
}

/** muted 상태를 localStorage에서 읽기 */
function readMuted(): boolean {
  try {
    return localStorage.getItem('meercop_alarm_muted') === 'true';
  } catch {
    return false;
  }
}

function getAlarmState(): AlarmState {
  const w = window as unknown as { __meercop_alarm?: AlarmState };
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = {
      generation: 0,
      playing: false,
      dismissedIds: loadDismissedIds(),
      lastPlayedId: null,
      muted: readMuted(),
      suppressUntil: 0,
    };
  }
  // 항상 localStorage에서 muted 상태를 동기화
  w.__meercop_alarm.muted = readMuted();
  return w.__meercop_alarm;
}

/** muted 상태를 설정하고 localStorage에 영구 저장 */
function setAlarmMuted(muted: boolean) {
  const s = getAlarmState();
  s.muted = muted;
  try { localStorage.setItem('meercop_alarm_muted', String(muted)); } catch {}
  if (muted) stopAlertSound();
}

// 모든 AudioContext & interval을 전역 배열로 추적
function getAllContexts(): AudioContext[] {
  const w = window as any;
  if (!w.__meercop_ctxs) w.__meercop_ctxs = [];
  return w.__meercop_ctxs;
}
function getAllIntervals(): ReturnType<typeof setInterval>[] {
  const w = window as any;
  if (!w.__meercop_ivals) w.__meercop_ivals = [];
  return w.__meercop_ivals;
}

/** 모든 경보음을 즉시 중지 */
function stopAlertSound() {
  const s = getAlarmState();
  s.generation++;  // 진행 중인 모든 playOnce 루프 무효화
  s.playing = false;

  // 모든 인터벌 정리
  for (const id of getAllIntervals()) {
    clearInterval(id);
  }
  (window as any).__meercop_ivals = [];

  // 모든 AudioContext 정리 — destination 연결 끊기 + 즉시 close
  for (const ctx of getAllContexts()) {
    try {
      // suspend로 즉시 오디오 출력 중단 (이미 스케줄된 오실레이터 포함)
      ctx.suspend().catch(() => {});
      ctx.close().catch(() => {});
    } catch { /* already closed */ }
  }
  (window as any).__meercop_ctxs = [];

  console.log("[useAlerts] 🔇 Alarm stopped (gen:", s.generation, ")");
}

function playAlertSoundLoop() {
  const s = getAlarmState();
  // 재확인: localStorage에서 직접 읽기
  const isMuted = localStorage.getItem('meercop_alarm_muted') === 'true';
  if (isMuted || s.muted) {
    console.log("[useAlerts] ⏭️ Alarm muted, skipping");
    s.muted = true;
    stopAlertSound();
    return;
  }
  if (s.suppressUntil > Date.now()) {
    console.log("[useAlerts] ⏭️ Suppressed after dismiss, skipping");
    return;
  }
  if (s.playing) {
    return; // 이미 재생 중이면 조용히 무시
  }
  stopAlertSound();

  s.playing = true;
  const myGen = s.generation; // 이 루프의 세대 번호
  console.log("[useAlerts] 🔊 Starting alarm (gen:", myGen, ")");

  try {
    const ctx = new AudioContext();
    getAllContexts().push(ctx);

    const playOnce = () => {
      const cur = getAlarmState();
      // 세대가 바뀌었거나, muted이거나, 재생 중이 아니거나, suppress 중이면 즉시 중단
      if (cur.generation !== myGen || cur.muted || !cur.playing || cur.suppressUntil > Date.now()) {
        // 좀비 루프면 완전히 정리
        if (cur.generation !== myGen || !cur.playing) {
          try { ctx.suspend().catch(() => {}); ctx.close().catch(() => {}); } catch {}
        }
        return;
      }
      // 재확인: localStorage 직접 읽기
      const mutedNow = localStorage.getItem('meercop_alarm_muted') === 'true';
      if (mutedNow) {
        cur.muted = true;
        stopAlertSound();
        return;
      }
      if (ctx.state === 'closed') return;
      
      const beep = (time: number, freq: number) => {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "square";
          gain.gain.value = 0.4;
          osc.start(ctx.currentTime + time);
          osc.stop(ctx.currentTime + time + 0.2);
        } catch { /* closed */ }
      };
      beep(0, 880);
      beep(0.3, 1100);
      beep(0.6, 880);
      beep(0.9, 1100);
      beep(1.2, 880);
      beep(1.5, 1100);
    };

    playOnce();
    const intervalId = setInterval(playOnce, 2500);
    getAllIntervals().push(intervalId);
  } catch {
    stopAlertSound();
  }
}

// 모듈 로드 시 좀비 정리
stopAlertSound();

export { stopAlertSound, getAlarmState, setAlarmMuted };

export interface ActiveAlert {
  id: string;
  type: LocalAlertType;
  title: string;
  message: string | null;
  created_at: string;
}

export const useAlerts = (deviceId?: string | null) => {
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const activeAlertRef = useRef<ActiveAlert | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const deviceIdRef = useRef(deviceId);
  const mountedRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);

  deviceIdRef.current = deviceId;

  // 안전한 setState 래퍼 — HMR 중 fiber 손상 방지
  const safeSetAlerts = useCallback((v: LocalActivityLog[]) => {
    if (!mountedRef.current) return;
    try { setAlerts(v); } catch (e) { console.warn("[useAlerts] setState blocked:", e); }
  }, []);
  const safeSetActiveAlert = useCallback((v: ActiveAlert | null) => {
    if (!mountedRef.current) return;
    try { setActiveAlert(v); } catch (e) { console.warn("[useAlerts] setState blocked:", e); }
  }, []);
  const safeSetIsLoading = useCallback((v: boolean) => {
    if (!mountedRef.current) return;
    try { setIsLoading(v); } catch (e) { console.warn("[useAlerts] setState blocked:", e); }
  }, []);

  // unmount 시 flag 설정
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadAlerts = useCallback(() => {
    const did = deviceIdRef.current;
    if (!did) {
      safeSetAlerts([]); safeSetIsLoading(false);
      return;
    }
    const logs = getAlertLogs(did, 50);
    safeSetAlerts(logs); safeSetIsLoading(false);
  }, [safeSetAlerts, safeSetIsLoading]);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  // 초기 로드
  useEffect(() => {
    loadAlerts();
  }, [deviceId]); // deviceId 변경 시 다시 로드

  // ── 채널 구독 (deviceId가 변경될 때만 재생성) ──
  useEffect(() => {
    if (!deviceId) return;

    const channelName = `device-alerts-${deviceId}`;
    let intentionalClose = false; // cleanup 시 CLOSED 이벤트 무시용

    // 이전 채널 정리
    if (channelRef.current) {
      try { supabase.removeChannel(channelRef.current); } catch {}
      channelRef.current = null;
    }

    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!mountedRef.current) return;
        const presState = channel.presenceState();
        
        let foundAlert: ActiveAlert | null = null;
        for (const key of Object.keys(presState)) {
          const entries = presState[key] as Array<{ active_alert?: ActiveAlert }>;
          for (const entry of entries) {
            if (entry.active_alert) {
              foundAlert = entry.active_alert;
              break;
            }
          }
          if (foundAlert) break;
        }
        
        if (foundAlert) {
          const s = getAlarmState();
          if (s.dismissedIds.has(foundAlert.id)) return;
          if (s.suppressUntil > Date.now()) return;
          const alertAge = Date.now() - new Date(foundAlert.created_at).getTime();
          const isStale = alertAge > 5 * 60 * 1000;
          if (isStale) {
            s.dismissedIds.add(foundAlert.id);
            saveDismissedIds(s.dismissedIds);
            // stale alert는 UI에 표시하지 않음
            return;
          }
          if (s.lastPlayedId === foundAlert.id) {
            // 이미 처리된 alert — UI를 다시 설정하지 않음 (dismiss 후 재표시 방지)
            return;
          }
          const isMuted = readMuted();
          console.log("[useAlerts] New alert from Presence:", foundAlert.id, "muted:", isMuted);
          safeSetActiveAlert(foundAlert);
          activeAlertRef.current = foundAlert;
          s.lastPlayedId = foundAlert.id;
          if (!isMuted && !s.muted) {
            playAlertSoundLoop();
          } else {
            console.log("[useAlerts] ⏭️ Skipping sound (muted)");
          }
          try {
            addActivityLog(deviceId, foundAlert.type, {
              title: foundAlert.title,
              message: foundAlert.message,
              alertType: foundAlert.type,
            });
          } catch { /* storage quota */ }
          loadAlerts();
        } else {
          // alert가 presence에서 사라진 경우 UI만 정리 — 알람은 dismiss로만 정지
          // (presence sync 시 일시적으로 alert가 안 보일 수 있으므로 알람을 여기서 끄지 않음)
          if (activeAlertRef.current) {
            safeSetActiveAlert(null);
            activeAlertRef.current = null;
          }
        }
      })
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) {
          const s = getAlarmState();
          if (s.dismissedIds.has(alert.id)) return;
          if (s.suppressUntil > Date.now()) return;
          const alertAge = Date.now() - new Date(alert.created_at).getTime();
          if (alertAge > 5 * 60 * 1000) {
            s.dismissedIds.add(alert.id);
            saveDismissedIds(s.dismissedIds);
            return;
          }
          if (s.lastPlayedId === alert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== alert.id) {
              safeSetActiveAlert(alert);
              activeAlertRef.current = alert;
            }
            return;
          }
          const isMuted = readMuted();
          safeSetActiveAlert(alert);
          activeAlertRef.current = alert;
          s.lastPlayedId = alert.id;
          if (!isMuted && !s.muted) {
            playAlertSoundLoop();
          }
          try {
            addActivityLog(deviceId, alert.type, {
              title: alert.title,
              message: alert.message,
              alertType: alert.type,
            });
          } catch { /* storage quota */ }
          loadAlerts();
        }
      })
      .on('broadcast', { event: 'remote_alarm_off' }, () => {
        console.log("[useAlerts] remote_alarm_off received (no-op on phone)");
      })
      .subscribe(async (status) => {
        console.log("[useAlerts] Channel status:", status);
        if (status === 'SUBSCRIBED' && mountedRef.current) {
          await channel.track({ role: 'phone', joined_at: new Date().toISOString() });
        }
        // 의도적 cleanup에 의한 CLOSED는 무시 — 재시도 루프 방지
        if (status === 'CLOSED' && intentionalClose) return;
      });

    return () => {
      intentionalClose = true; // cleanup CLOSED 이벤트 무시
      channelRef.current = null;
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [deviceId]);

  const markAsRead = {
    mutate: (alertId: string) => {
      markLogAsRead(alertId);
      loadAlerts();
    },
  };

  const markAllAsRead = {
    mutate: () => {
      const did = deviceIdRef.current;
      if (did) {
        markAllLogsAsRead(did);
        loadAlerts();
      }
    },
  };

  const dismissActiveAlert = useCallback(async () => {
    stopAlertSound();
    const s = getAlarmState();
    s.suppressUntil = Date.now() + 30000;
    if (activeAlertRef.current) {
      s.dismissedIds.add(activeAlertRef.current.id);
      saveDismissedIds(s.dismissedIds);
    }
    s.playing = false;
    // lastPlayedId를 유지하여 동일 alert ID의 재트리거 방지 (dismiss 후에도 presence에 남아있을 수 있음)
    safeSetActiveAlert(null);
    activeAlertRef.current = null;
    
    const did = deviceIdRef.current;
    if (!did) return;
    
    try {
      const ch = channelRef.current;
      if (ch) {
        await ch.track({
          role: 'phone',
          active_alert: null,
          dismissed_at: new Date().toISOString(),
        });
        console.log("[useAlerts] Dismiss synced");
      }
    } catch (err) {
      console.error("[useAlerts] Dismiss sync failed:", err);
    }
  }, []);

  /** 컴퓨터 경보음 원격 해제 — 이미 구독된 채널에서 broadcast 전송 */
  const sendRemoteAlarmOff = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch) {
      console.error("[useAlerts] No subscribed channel for remote_alarm_off");
      throw new Error("채널 미연결");
    }
    await ch.send({
      type: 'broadcast',
      event: 'remote_alarm_off',
      payload: {
        dismissed_at: new Date().toISOString(),
        dismissed_by: 'smartphone',
        remote_alarm_off: true,
      },
    });
    console.log("[useAlerts] remote_alarm_off sent via subscribed channel");
  }, []);

  return {
    alerts,
    activeAlert,
    unreadCount,
    isLoading,
    error: null,
    markAsRead,
    markAllAsRead,
    dismissActiveAlert,
    sendRemoteAlarmOff,
    refreshAlerts: loadAlerts,
  };
};
