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
import * as AlarmSound from "@/lib/alarmSound";

// stop()이 window 전역 싱글톤을 정리하므로 단순 위임
export const stopAlertSound = () => AlarmSound.stop();
export const getAlarmState = () => ({ muted: AlarmSound.isMuted() });
export const setAlarmMuted = AlarmSound.setMuted;

// 모듈 로드 시 구 코드 잔여 알람 즉시 정리
stopAlertSound();

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
  const lastPlayedIdRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  deviceIdRef.current = deviceId;

  // 안전한 setState 래퍼
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

  useEffect(() => {
    loadAlerts();
  }, [deviceId]);

  /** 공통 alert 처리 로직 */
  const handleIncomingAlert = useCallback((alert: ActiveAlert) => {
    // 이미 처리한 동일 alert → 무시 (가장 먼저 체크 — 중복 호출 방지)
    if (lastPlayedIdRef.current === alert.id) return;
    if (AlarmSound.isDismissed(alert.id)) return;
    if (AlarmSound.isSuppressed()) return;

    const alertAge = Date.now() - new Date(alert.created_at).getTime();
    // 60초 이상 된 alert는 stale (페이지 새로고침 시 재트리거 방지)
    if (alertAge > 60 * 1000) {
      AlarmSound.addDismissed(alert.id);
      return;
    }

    const muted = AlarmSound.isMuted();
    console.log("[useAlerts] New alert:", alert.id, "muted:", muted);

    safeSetActiveAlert(alert);
    activeAlertRef.current = alert;
    lastPlayedIdRef.current = alert.id;

    if (!muted) {
      AlarmSound.play();
    }

    const did = deviceIdRef.current;
    if (did) {
      try {
        addActivityLog(did, alert.type, {
          title: alert.title,
          message: alert.message,
          alertType: alert.type,
        });
      } catch {}
      loadAlerts();
    }
  }, [safeSetActiveAlert, loadAlerts]);

  // ── 채널 구독 ──
  useEffect(() => {
    if (!deviceId) return;

    const channelName = `device-alerts-${deviceId}`;
    let intentionalClose = false;

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
          handleIncomingAlert(foundAlert);
        } else {
          // alert가 presence에서 사라져도 알람 재생 중이면 activeAlertRef 유지
          if (activeAlertRef.current && !AlarmSound.isPlaying()) {
            safeSetActiveAlert(null);
            activeAlertRef.current = null;
          }
        }
      })
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) {
          handleIncomingAlert(alert);
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
        if (status === 'CLOSED' && intentionalClose) return;
      });

    return () => {
      intentionalClose = true;
      channelRef.current = null;
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [deviceId, handleIncomingAlert]);

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

  /** 스마트폰 경보음만 해제 (로컬 알람 정지, presence/broadcast 건드리지 않음) */
  const dismissPhoneAlarm = useCallback(() => {
    stopAlertSound();
    AlarmSound.suppressFor(30000);
    const alertId = activeAlertRef.current?.id || lastPlayedIdRef.current;
    if (alertId) {
      AlarmSound.addDismissed(alertId);
      console.log("[useAlerts] Phone alarm dismissed:", alertId);
    }
  }, []);

  /** 전체 경보 해제 (스마트폰 알람 정지 + UI 정리 + presence 동기화) */
  const dismissActiveAlert = useCallback(async () => {
    stopAlertSound();
    AlarmSound.suppressFor(30000);
    const alertId = activeAlertRef.current?.id || lastPlayedIdRef.current;
    if (alertId) {
      AlarmSound.addDismissed(alertId);
      console.log("[useAlerts] Dismissed alert:", alertId);
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
  }, [safeSetActiveAlert]);

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
    dismissPhoneAlarm,
    dismissActiveAlert,
    sendRemoteAlarmOff,
    refreshAlerts: loadAlerts,
  };
};
