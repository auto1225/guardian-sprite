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
  ctx: AudioContext | null;
  intervalId: ReturnType<typeof setInterval> | null;
  playing: boolean;
  dismissedIds: Set<string>;
  lastPlayedId: string | null;
  muted: boolean;
}

function getAlarmState(): AlarmState {
  const w = window as unknown as { __meercop_alarm?: AlarmState };
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = {
      ctx: null,
      intervalId: null,
      playing: false,
      dismissedIds: new Set(),
      lastPlayedId: null,
      muted: false,
    };
  }
  return w.__meercop_alarm;
}

/** 모든 경보음을 즉시 중지 */
function stopAlertSound() {
  const s = getAlarmState();
  if (s.intervalId !== null) {
    clearInterval(s.intervalId);
    s.intervalId = null;
  }
  if (s.ctx) {
    try { s.ctx.close().catch(() => {}); } catch { /* already closed */ }
    s.ctx = null;
  }
  if (s.playing) {
    console.log("[useAlerts] 🔇 Alarm stopped");
  }
  s.playing = false;
}

function playAlertSoundLoop() {
  const s = getAlarmState();
  if (s.muted) {
    console.log("[useAlerts] ⏭️ Alarm muted, skipping");
    return;
  }
  // 이미 재생 중이면 중복 재생 방지
  if (s.playing) {
    console.log("[useAlerts] ⏭️ Already playing, skipping");
    return;
  }
  // 혹시 남아있는 이전 리소스 정리
  stopAlertSound();

  s.playing = true;
  console.log("[useAlerts] 🔊 Starting alarm");

  try {
    const ctx = new AudioContext();
    s.ctx = ctx;

    const playOnce = () => {
      const cur = getAlarmState();
      if (!cur.playing || !cur.ctx || cur.ctx.state === 'closed') {
        stopAlertSound();
        return;
      }
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
    s.intervalId = setInterval(playOnce, 2500);
  } catch {
    stopAlertSound();
  }
}

// 모듈 로드 시 좀비 정리
stopAlertSound();

export { stopAlertSound, getAlarmState };

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

  // unmount 시 flag 설정
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadAlerts = useCallback(() => {
    const did = deviceIdRef.current;
    if (!did) {
      if (mountedRef.current) { setAlerts([]); setIsLoading(false); }
      return;
    }
    const logs = getAlertLogs(did, 50);
    if (mountedRef.current) { setAlerts(logs); setIsLoading(false); }
  }, []);

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
          if (s.lastPlayedId === foundAlert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== foundAlert.id) {
              if (mountedRef.current) setActiveAlert(foundAlert);
              activeAlertRef.current = foundAlert;
            }
            return;
          }
          console.log("[useAlerts] New alert from Presence:", foundAlert.id);
          if (mountedRef.current) setActiveAlert(foundAlert);
          activeAlertRef.current = foundAlert;
          s.lastPlayedId = foundAlert.id;
          playAlertSoundLoop();
          try {
            addActivityLog(deviceId, foundAlert.type, {
              title: foundAlert.title,
              message: foundAlert.message,
              alertType: foundAlert.type,
            });
          } catch { /* storage quota */ }
          loadAlerts();
        } else {
          const s = getAlarmState();
          s.dismissedIds.clear();
          s.lastPlayedId = null;
          stopAlertSound();
          if (mountedRef.current) setActiveAlert(null);
          activeAlertRef.current = null;
        }
      })
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) {
          const s = getAlarmState();
          if (s.dismissedIds.has(alert.id)) return;
          if (s.lastPlayedId === alert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== alert.id) {
              if (mountedRef.current) setActiveAlert(alert);
              activeAlertRef.current = alert;
            }
            return;
          }
          if (mountedRef.current) setActiveAlert(alert);
          activeAlertRef.current = alert;
          s.lastPlayedId = alert.id;
          playAlertSoundLoop();
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
    if (activeAlertRef.current) {
      const s = getAlarmState();
      s.dismissedIds.add(activeAlertRef.current.id);
      s.lastPlayedId = null;
    }
    if (mountedRef.current) setActiveAlert(null);
    activeAlertRef.current = null;
    
    const did = deviceIdRef.current;
    if (!did) return;
    
    // 기존 채널로 dismiss 동기화
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

  return {
    alerts,
    activeAlert,
    unreadCount,
    isLoading,
    error: null,
    markAsRead,
    markAllAsRead,
    dismissActiveAlert,
    refreshAlerts: loadAlerts,
  };
};
