/**
 * useAlerts — 스마트폰 경보 수신/해제 훅 (사용자 단일 채널)
 *
 * 채널 구조:
 *   - user-alerts-{userId} 단일 채널로 모든 기기의 경보를 수신
 *   - 각 노트북은 key=deviceId로 Presence track
 *   - 브로드캐스트 payload에 device_id 포함
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  addActivityLog,
  getAlertLogs,
  markLogAsRead,
  markAllLogsAsRead,
  LocalActivityLog,
  LocalAlertType,
} from "@/lib/localActivityLogs";
import * as Alarm from "@/lib/alarmSound";

export interface ActiveAlert {
  id: string;
  type: LocalAlertType;
  title: string;
  message: string | null;
  created_at: string;
}

export const stopAlertSound = Alarm.stop;
export const getAlarmState = () => ({ muted: Alarm.isMuted() });
export const setAlarmMuted = Alarm.setMuted;

export const useAlerts = (deviceId?: string | null) => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSubscribedRef = useRef(false);
  const mountedRef = useRef(true);
  const deviceIdRef = useRef(deviceId);
  const activeAlertRef = useRef<ActiveAlert | null>(null);
  const handleAlertRef = useRef<(alert: ActiveAlert, fromDeviceId?: string) => void>(() => {});
  const userIdRef = useRef(user?.id);

  deviceIdRef.current = deviceId;
  userIdRef.current = user?.id;

  // ── safe setState ──
  const safe = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (v: T) => { if (mountedRef.current) try { setter(v); } catch {} };
  const safeSetAlerts = useCallback(safe(setAlerts), []);
  const safeSetActiveAlert = useCallback(safe(setActiveAlert), []);
  const safeSetIsLoading = useCallback(safe(setIsLoading), []);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── 로컬 로그 로드 ──
  const loadAlerts = useCallback(() => {
    safeSetAlerts(getAlertLogs(undefined, 50));
    safeSetIsLoading(false);
  }, [safeSetAlerts, safeSetIsLoading]);

  useEffect(() => { loadAlerts(); }, [deviceId]);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  // ── 경보 수신 처리 ──
  const handleAlert = useCallback((alert: ActiveAlert, fromDeviceId?: string) => {
    if (Alarm.isMuted()) {
      console.log("[useAlerts] ⏭ Muted, ignoring alert:", alert.id);
      return;
    }
    if (Alarm.isDismissed(alert.id)) {
      console.log("[useAlerts] ⏭ Already dismissed:", alert.id);
      return;
    }
    if (Alarm.isSuppressed()) {
      console.log("[useAlerts] ⏭ Suppressed, ignoring alert:", alert.id);
      return;
    }

    const alertTime = new Date(alert.created_at).getTime();
    const lastStopped = Alarm.getLastStoppedAt();
    if (alertTime <= lastStopped) {
      console.log("[useAlerts] ⏭ Alert created before last stop, ignoring:", alert.id, "alertTime:", alertTime, "lastStopped:", lastStopped);
      return;
    }

    const age = Date.now() - alertTime;
    if (age > 60_000) {
      console.log("[useAlerts] ⏭ Stale alert (age:", Math.round(age / 1000), "s), dismissing:", alert.id);
      Alarm.addDismissed(alert.id);
      return;
    }

    if (activeAlertRef.current?.id === alert.id) return;

    console.log("[useAlerts] 🚨 New alert:", alert.id, "from device:", fromDeviceId?.slice(0, 8), "age:", Math.round(age / 1000), "s");
    activeAlertRef.current = alert;
    safeSetActiveAlert(alert);

    if (!Alarm.isPlaying() && !Alarm.isMuted()) {
      console.log("[useAlerts] 🔊 Starting alarm sound...");
      Alarm.play();
    } else {
      console.log("[useAlerts] ⏭ Alarm already playing or muted, skipping play");
    }

    const logDeviceId = fromDeviceId || deviceIdRef.current;
    if (logDeviceId) {
      try {
        addActivityLog(logDeviceId, alert.type, {
          title: alert.title,
          message: alert.message,
          alertType: alert.type,
        });
      } catch {}
      loadAlerts();
    }
  }, [loadAlerts, safeSetActiveAlert]);

  handleAlertRef.current = handleAlert;

  // ── 단일 채널 구독: user-alerts-{userId} ──
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    const channelName = `user-alerts-${userId}`;

    // 기존 동일 토픽 채널 정리
    const existing = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existing) supabase.removeChannel(existing);

    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    isSubscribedRef.current = false;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!mountedRef.current) return;
        const state = channel.presenceState();

        // 모든 key 순회 — key=deviceId (phone 제외)
        for (const key of Object.keys(state)) {
          if (key === 'phone') continue;
          const entries = state[key] as Array<{
            active_alert?: ActiveAlert | null;
            status?: string;
          }>;
          for (const entry of entries) {
            if (entry.status === 'listening') continue;
            if (entry.active_alert) {
              handleAlertRef.current(entry.active_alert, key);
              return; // 하나만 처리
            }
          }
        }
      })
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        const fromDevice = payload?.payload?.device_id as string | undefined;
        if (alert) handleAlertRef.current(alert, fromDevice);
      })
      .on('broadcast', { event: 'remote_alarm_off' }, () => {})
      .subscribe(async (status) => {
        console.log(`[useAlerts] Channel user-alerts:`, status);
        if (status === 'SUBSCRIBED' && mountedRef.current) {
          isSubscribedRef.current = true;
          await channel.track({ role: 'phone', joined_at: new Date().toISOString() });
        }
      });

    return () => {
      isSubscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ── 컴퓨터 경보음 원격 해제 ──
  const dismissRemoteAlarm = useCallback(async () => {
    const did = deviceIdRef.current;
    if (!did) throw new Error("디바이스 미선택");

    const userId = userIdRef.current;
    if (!userId) throw new Error("로그인 필요");

    const channelName = `user-alerts-${userId}`;
    const dismissPayload = {
      dismissed_at: new Date().toISOString(),
      dismissed_by: 'smartphone',
      remote_alarm_off: true,
      device_id: did, // 대상 기기 지정
    };

    // 메인 채널이 살아있으면 바로 전송
    if (channelRef.current && isSubscribedRef.current) {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'remote_alarm_off',
        payload: dismissPayload,
      });
      console.log("[useAlerts] ✅ Remote alarm off sent (main channel):", dismissPayload.dismissed_at);
      return;
    }

    // 메인 채널이 죽었으면 → 새 채널 생성 (self-healing)
    console.log("[useAlerts] Main channel dead, creating fresh channel");
    const existingCh = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existingCh) supabase.removeChannel(existingCh);

    const freshChannel = supabase.channel(channelName);

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("채널 연결 시간 초과")), 5000);
        freshChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') { clearTimeout(timeout); reject(new Error(status)); }
        });
      });

      await freshChannel.send({
        type: 'broadcast',
        event: 'remote_alarm_off',
        payload: dismissPayload,
      });

      channelRef.current = freshChannel;
      isSubscribedRef.current = true;
      console.log("[useAlerts] ✅ Remote alarm off sent (fresh channel):", dismissPayload.dismissed_at);
    } catch (err) {
      supabase.removeChannel(freshChannel);
      throw err;
    }
  }, []);

  // ── 전체 해제 ──
  const dismissAll = useCallback(() => {
    Alarm.stop();
    const id = activeAlertRef.current?.id;
    if (id) Alarm.addDismissed(id);
    safeSetActiveAlert(null);
    activeAlertRef.current = null;
    console.log("[useAlerts] ✅ All dismissed");
  }, [safeSetActiveAlert]);

  return {
    alerts,
    activeAlert,
    unreadCount,
    isLoading,
    error: null,
    markAsRead: { mutate: (id: string) => { markLogAsRead(id); loadAlerts(); } },
    markAllAsRead: { mutate: () => { markAllLogsAsRead(); loadAlerts(); } },
    dismissRemoteAlarm,
    dismissAll,
    refreshAlerts: loadAlerts,
  };
};
