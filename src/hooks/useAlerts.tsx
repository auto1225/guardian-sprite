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

let alarmIntervalId: ReturnType<typeof setInterval> | null = null;
let alarmAudioCtx: AudioContext | null = null;

function playAlertSoundLoop() {
  stopAlertSound(); // 기존 경보 중복 방지
  console.log("[useAlerts] 🔊 Starting alarm sound loop");
  try {
    alarmAudioCtx = new AudioContext();
    const playOnce = () => {
      if (!alarmAudioCtx || alarmAudioCtx.state === 'closed') {
        console.log("[useAlerts] AudioContext closed, stopping loop");
        stopAlertSound();
        return;
      }
      const ctx = alarmAudioCtx;
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
        } catch {
          // context closed
        }
      };
      playBeep(0, 880);
      playBeep(0.3, 1100);
      playBeep(0.6, 880);
      playBeep(0.9, 1100);
      playBeep(1.2, 880);
      playBeep(1.5, 1100);
    };
    playOnce(); // 즉시 1회
    alarmIntervalId = setInterval(playOnce, 2500); // 2.5초 간격 반복
  } catch {
    // Audio not available
  }
}

function stopAlertSound() {
  if (alarmIntervalId || alarmAudioCtx) {
    console.log("[useAlerts] 🔇 Stopping alarm sound");
  }
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  if (alarmAudioCtx) {
    alarmAudioCtx.close().catch(() => {});
    alarmAudioCtx = null;
  }
}

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
  const dismissedAlertIdsRef = useRef<Set<string>>(new Set());
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
          // 이미 해제한 경보는 무시
          if (dismissedAlertIdsRef.current.has(foundAlert.id)) {
            return;
          }
          console.log("[useAlerts] Active alert from Presence:", foundAlert);
          const prevAlert = activeAlertRef.current;
          setActiveAlert(foundAlert);
          activeAlertRef.current = foundAlert;
          
          if (!prevAlert || prevAlert.id !== foundAlert.id) {
            playAlertSoundLoop();
            addActivityLog(deviceId, foundAlert.type, {
              title: foundAlert.title,
              message: foundAlert.message,
              alertType: foundAlert.type,
            });
            loadAlerts();
          }
        } else {
          // 노트북이 경보를 해제했으므로 dismissed 목록도 클리어
          dismissedAlertIdsRef.current.clear();
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
          if (dismissedAlertIdsRef.current.has(alert.id)) {
            return;
          }
          const prevAlert = activeAlertRef.current;
          setActiveAlert(alert);
          activeAlertRef.current = alert;
          
          if (!prevAlert || prevAlert.id !== alert.id) {
            playAlertSoundLoop();
            addActivityLog(deviceId, alert.type, {
              title: alert.title,
              message: alert.message,
              alertType: alert.type,
            });
            loadAlerts();
          }
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
      stopAlertSound();
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

  // 활성 알림 해제 + Presence로 랩탑에 동기화
  const dismissActiveAlert = useCallback(async () => {
    stopAlertSound();
    // 해제한 경보 ID 기록 → Presence 재sync 시 무시
    if (activeAlertRef.current) {
      dismissedAlertIdsRef.current.add(activeAlertRef.current.id);
    }
    setActiveAlert(null);
    activeAlertRef.current = null;
    
    if (!deviceId) return;
    
    // Presence 채널에 해제 상태 전송 → 랩탑이 이를 감지하여 경보 해제
    try {
      const channel = supabase.channel(`device-alerts-${deviceId}`);
      await channel.subscribe();
      await channel.track({
        active_alert: null,
        dismissed_at: new Date().toISOString(),
      });
      console.log("[useAlerts] Dismiss synced via Presence");
      // 잠시 후 채널 정리
      setTimeout(() => {
        supabase.removeChannel(channel);
      }, 2000);
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
