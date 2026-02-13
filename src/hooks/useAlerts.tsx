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

// 하위 호환성을 위한 re-export
export const stopAlertSound = AlarmSound.stop;
export const getAlarmState = () => ({ muted: AlarmSound.isMuted() });
export const setAlarmMuted = AlarmSound.setMuted;

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
    if (AlarmSound.isDismissed(alert.id)) return;
    if (AlarmSound.isSuppressed()) return;

    const alertAge = Date.now() - new Date(alert.created_at).getTime();
    if (alertAge > 5 * 60 * 1000) {
      AlarmSound.addDismissed(alert.id);
      return;
    }

    // 이미 처리한 동일 alert → 무시 (dismiss 후 presence에 잔류할 수 있음)
    if (lastPlayedIdRef.current === alert.id) return;

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

  const dismissActiveAlert = useCallback(async () => {
    AlarmSound.stop();
    AlarmSound.suppressFor(30000);
    if (activeAlertRef.current) {
      AlarmSound.addDismissed(activeAlertRef.current.id);
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
    dismissActiveAlert,
    sendRemoteAlarmOff,
    refreshAlerts: loadAlerts,
  };
};
