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

// window 전역에 경보음 상태를 저장 — HMR/핫 리로드 후에도 이전 경보음 추적 가능
interface AlarmState {
  contexts: AudioContext[];
  intervals: ReturnType<typeof setInterval>[];
  playing: boolean;
  dismissedIds: Set<string>;
  lastPlayedId: string | null;
  muted: boolean; // 경보음 비활성화 설정
}

function getAlarmState(): AlarmState {
  const w = window as unknown as { __meercop_alarm?: AlarmState };
  if (!w.__meercop_alarm) {
    w.__meercop_alarm = {
      contexts: [],
      intervals: [],
      playing: false,
      dismissedIds: new Set(),
      lastPlayedId: null,
      muted: w.__meercop_alarm?.muted ?? false,
    };
  }
  return w.__meercop_alarm;
}

function stopAlertSound() {
  const state = getAlarmState();
  if (state.playing || state.contexts.length > 0 || state.intervals.length > 0) {
    console.log("[useAlerts] 🔇 Stopping ALL alarm sounds", {
      contexts: state.contexts.length,
      intervals: state.intervals.length,
    });
  }
  state.playing = false;
  for (const id of state.intervals) {
    clearInterval(id);
  }
  state.intervals.length = 0;
  for (const ctx of state.contexts) {
    try { ctx.close().catch(() => {}); } catch { /* already closed */ }
  }
  state.contexts.length = 0;
}

function playAlertSoundLoop() {
  const state = getAlarmState();
  if (state.playing || state.muted) {
    console.log("[useAlerts] ⏭️ Alarm skipped", { playing: state.playing, muted: state.muted });
    return;
  }
  stopAlertSound(); // 이전 핫 리로드의 좀비 경보음도 정리
  state.playing = true;
  console.log("[useAlerts] 🔊 Starting alarm sound loop");
  try {
    const ctx = new AudioContext();
    state.contexts.push(ctx);
    const playOnce = () => {
      const s = getAlarmState();
      if (ctx.state === 'closed' || !s.playing) {
        stopAlertSound();
        return;
      }
      const playBeep = (time: number, freq: number) => {
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
        } catch { /* context closed */ }
      };
      playBeep(0, 880);
      playBeep(0.3, 1100);
      playBeep(0.6, 880);
      playBeep(0.9, 1100);
      playBeep(1.2, 880);
      playBeep(1.5, 1100);
    };
    playOnce();
    const intervalId = setInterval(playOnce, 2500);
    state.intervals.push(intervalId);
  } catch {
    getAlarmState().playing = false;
  }
}

// 모듈 로드 시 이전 핫 리로드에서 남은 좀비 경보음 즉시 정리
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
  const [isLoading, setIsLoading] = useState(true);

  // 로컬 저장소에서 알림 로그 로드
  const loadAlerts = useCallback(() => {
    if (!deviceId) {
      setAlerts([]);
      setIsLoading(false);
      return;
    }
    
    const logs = getAlertLogs(deviceId, 50);
    setAlerts(logs);
    setIsLoading(false);
  }, [deviceId]);

  // 읽지 않은 알림 개수
  const unreadCount = alerts.filter(a => !a.is_read).length;

  // 초기 로드
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Presence + Broadcast 채널 구독
  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase.channel(`device-alerts-${deviceId}`);
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log("[useAlerts] Presence sync:", state);
        
        let foundAlert: ActiveAlert | null = null;
        for (const key of Object.keys(state)) {
          const entries = state[key] as Array<{ active_alert?: ActiveAlert }>;
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
          if (s.dismissedIds.has(foundAlert.id)) {
            return;
          }
          if (s.lastPlayedId === foundAlert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== foundAlert.id) {
              setActiveAlert(foundAlert);
              activeAlertRef.current = foundAlert;
            }
            return;
          }
          console.log("[useAlerts] Active alert from Presence:", foundAlert);
          setActiveAlert(foundAlert);
          activeAlertRef.current = foundAlert;
          s.lastPlayedId = foundAlert.id;
          playAlertSoundLoop();
          addActivityLog(deviceId, foundAlert.type, {
            title: foundAlert.title,
            message: foundAlert.message,
            alertType: foundAlert.type,
          });
          loadAlerts();
        } else {
          const s = getAlarmState();
          s.dismissedIds.clear();
          s.lastPlayedId = null;
          stopAlertSound();
          setActiveAlert(null);
          activeAlertRef.current = null;
        }
      })
      // Broadcast로 전달되는 active_alert도 수신
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        console.log("[useAlerts] Broadcast active_alert:", payload);
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) {
          const s = getAlarmState();
          if (s.dismissedIds.has(alert.id)) {
            return;
          }
          if (s.lastPlayedId === alert.id) {
            if (!activeAlertRef.current || activeAlertRef.current.id !== alert.id) {
              setActiveAlert(alert);
              activeAlertRef.current = alert;
            }
            return;
          }
          setActiveAlert(alert);
          activeAlertRef.current = alert;
          s.lastPlayedId = alert.id;
          playAlertSoundLoop();
          addActivityLog(deviceId, alert.type, {
            title: alert.title,
            message: alert.message,
            alertType: alert.type,
          });
          loadAlerts();
        }
      })
      // remote_alarm_off 수신 시 알림 해제하지 않음 (컴퓨터 경보음만 해제)
      .on('broadcast', { event: 'remote_alarm_off' }, () => {
        console.log("[useAlerts] remote_alarm_off received (no-op on phone)");
      })
      .subscribe(async (status) => {
        console.log("[useAlerts] Channel status:", status);
        if (status === 'SUBSCRIBED') {
          // Presence에 참여하여 채널 연결 유지
          await channel.track({ role: 'phone', joined_at: new Date().toISOString() });
          console.log("[useAlerts] Tracked presence as phone");
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [deviceId, loadAlerts]);

  // 알림 읽음 처리
  const markAsRead = {
    mutate: (alertId: string) => {
      markLogAsRead(alertId);
      loadAlerts();
    },
  };

  const markAllAsRead = {
    mutate: () => {
      if (deviceId) {
        markAllLogsAsRead(deviceId);
        loadAlerts();
      }
    },
  };

  // 활성 알림 해제 + 기존 채널의 Presence로 랩탑에 동기화
  const dismissActiveAlert = useCallback(async () => {
    stopAlertSound();
    if (activeAlertRef.current) {
      const s = getAlarmState();
      s.dismissedIds.add(activeAlertRef.current.id);
      s.lastPlayedId = null;
    }
    setActiveAlert(null);
    activeAlertRef.current = null;
    
    if (!deviceId) return;
    
    // 기존 채널을 재사용하여 dismiss 동기화 (새 채널 생성 금지 — 좀비 경보 원인)
    try {
      const ch = channelRef.current;
      if (ch) {
        await ch.track({
          role: 'phone',
          active_alert: null,
          dismissed_at: new Date().toISOString(),
        });
        console.log("[useAlerts] Dismiss synced via existing channel");
      } else {
        console.warn("[useAlerts] No channel ref for dismiss sync");
      }
    } catch (err) {
      console.error("[useAlerts] Failed to sync dismiss:", err);
    }
  }, [deviceId]);

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
