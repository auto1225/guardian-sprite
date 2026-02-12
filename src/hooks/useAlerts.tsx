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

function getAlarmState(): AlarmState {
  const w = window as unknown as { __meercop_alarm?: AlarmState };
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = {
      generation: 0,
      playing: false,
      dismissedIds: new Set(),
      lastPlayedId: null,
      muted: false,
      suppressUntil: 0,
    };
  }
  // 항상 localStorage에서 muted 상태를 동기화
  try {
    w.__meercop_alarm.muted = localStorage.getItem('meercop_alarm_muted') === 'true';
  } catch {}
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

  // 모든 AudioContext 정리
  for (const ctx of getAllContexts()) {
    try { ctx.close().catch(() => {}); } catch { /* already closed */ }
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
    console.log("[useAlerts] ⏭️ Already playing, skipping");
    return;
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
      // 세대가 바뀌었으면 이 루프는 좀비 → 즉시 중단
      if (cur.generation !== myGen || cur.muted || !cur.playing) {
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

    // 이전 채널이 남아있으면 제거
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase.channel(`device-alerts-${deviceId}`);
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
          if (s.lastPlayedId === foundAlert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== foundAlert.id) {
              safeSetActiveAlert(foundAlert);
              activeAlertRef.current = foundAlert;
            }
            return;
          }
          // localStorage에서 직접 muted 재확인
          const isMuted = localStorage.getItem('meercop_alarm_muted') === 'true';
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
          stopAlertSound();
          safeSetActiveAlert(null);
          activeAlertRef.current = null;
        }
      })
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) {
          const s = getAlarmState();
          if (s.dismissedIds.has(alert.id)) return;
          if (s.suppressUntil > Date.now()) return;
          if (s.lastPlayedId === alert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== alert.id) {
              safeSetActiveAlert(alert);
              activeAlertRef.current = alert;
            }
            return;
          }
          const isMuted = localStorage.getItem('meercop_alarm_muted') === 'true';
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
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [deviceId]); // loadAlerts를 의존성에서 제거!

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
    // dismiss 후 5초간 새 알람 차단 (presence 재동기화로 인한 재트리거 방지)
    s.suppressUntil = Date.now() + 5000;
    if (activeAlertRef.current) {
      s.dismissedIds.add(activeAlertRef.current.id);
    }
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
