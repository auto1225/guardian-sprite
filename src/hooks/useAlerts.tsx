/**
 * useAlerts — 스마트폰 경보 수신/해제 훅 (사용자 단일 채널)
 *
 * 채널 구조:
 *   - user-alerts-{userId} 단일 채널로 모든 기기의 경보를 수신
 *   - 각 노트북은 key=deviceId로 Presence track
 *   - 브로드캐스트 payload에 device_id 포함
 *
 * 🔧 FIX v7: 경보음 재생의 유일한 권한자 (single authority)
 *   - usePhotoReceiver에서 독립 Alarm.play() 제거됨
 *   - 이 훅의 handleAlert()만이 경보음을 트리거함
 *   - suppress 시간 30초로 증가 (사진 전송 완료 대기)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { channelManager } from "@/lib/channelManager";
import {
  addActivityLog,
  getAlertLogs,
  markLogAsRead,
  markAllLogsAsRead,
  LocalActivityLog,
  LocalAlertType,
  isAlertIdProcessed,
  addProcessedAlertId,
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
  const { effectiveUserId } = useAuth();
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSubscribedRef = useRef(false);
  const mountedRef = useRef(true);
  const deviceIdRef = useRef(deviceId);
  const activeAlertRef = useRef<ActiveAlert | null>(null);
  const handleAlertRef = useRef<(alert: ActiveAlert, fromDeviceId?: string) => void>(() => {});
  const userIdRef = useRef(effectiveUserId);
  const lastAlertDeviceRef = useRef<string | null>(null);
  // ★ Per-device suppression — 해제 후 같은 기기의 모든 경보 차단
  const deviceSuppressRef = useRef<Map<string, number>>(new Map());

  deviceIdRef.current = deviceId;
  userIdRef.current = effectiveUserId;

  // ── safe setState (unmounted 컴포넌트 업데이트 방지) ──
  const safe = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (v: T) => { if (mountedRef.current) try { setter(v); } catch (err) { console.warn("[useAlerts] setState failed:", err); } };
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
    if (isAlertIdProcessed(alert.id)) {
      console.log("[useAlerts] ⏭ Already processed alert:", alert.id);
      return;
    }
    if (Alarm.isSuppressed()) {
      console.log("[useAlerts] ⏭ Suppressed, ignoring alert:", alert.id);
      return;
    }
    // ★ Per-device suppression — 해제된 기기에서 오는 모든 경보 차단
    if (fromDeviceId) {
      const deviceSuppressUntil = deviceSuppressRef.current.get(fromDeviceId);
      if (deviceSuppressUntil && Date.now() < deviceSuppressUntil) {
        console.log("[useAlerts] ⏭ Device suppressed:", fromDeviceId.slice(0, 8),
          "for", Math.round((deviceSuppressUntil - Date.now()) / 1000), "s more");
        Alarm.addDismissed(alert.id);
        return;
      }
    }

    const age = Date.now() - new Date(alert.created_at).getTime();
    if (age > 120_000) {
      console.log("[useAlerts] ⏭ Stale alert (age:", Math.round(age / 1000), "s), dismissing:", alert.id);
      Alarm.addDismissed(alert.id);
      return;
    }

    if (activeAlertRef.current?.id === alert.id) return;

    console.log("[useAlerts] 🚨 New alert:", alert.id, "from device:", fromDeviceId?.slice(0, 8), "age:", Math.round(age / 1000), "s");
    activeAlertRef.current = alert;
    lastAlertDeviceRef.current = fromDeviceId || null;
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
        // 처리 완료 등록 — 이후 Presence sync에서 재생성 차단
        addProcessedAlertId(alert.id);
        addActivityLog(logDeviceId, alert.type, {
          title: alert.title,
          message: alert.message,
          alertType: alert.type,
          eventData: { alertId: alert.id },
        });
      } catch (err) {
        console.error("[useAlerts] 활동 로그 저장 실패:", err);
      }
      loadAlerts();
    }
  }, [loadAlerts, safeSetActiveAlert]);

  handleAlertRef.current = handleAlert;

  // ── 단일 채널 구독: user-alerts-{userId} ──
  useEffect(() => {
    const userId = effectiveUserId;
    if (!userId) return;

    const channelName = `user-alerts-${userId}`;

    // 기존 채널 정리 후 ChannelManager로 생성
    channelManager.remove(channelName);
    const channel = channelManager.getOrCreate(channelName);
    channelRef.current = channel;
    isSubscribedRef.current = false;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!mountedRef.current) return;
        const state = channel.presenceState();
        const keys = Object.keys(state);
        console.log("[useAlerts] 📡 Presence sync, keys:", keys, "full state:", JSON.stringify(state).slice(0, 500));

        // 모든 key 순회 — key=deviceId (phone 제외)
        for (const key of keys) {
          const entries = state[key] as Array<{
            active_alert?: ActiveAlert | null;
            status?: string;
            role?: string;
          }>;
          console.log("[useAlerts] 🔍 Key:", key.slice(0, 8), "entries:", entries.length, "data:", JSON.stringify(entries).slice(0, 300));
          for (const entry of entries) {
            // ★ phone 엔트리 및 listening 상태 스킵
            if (entry.role === 'phone' || entry.status === 'listening') continue;
            if (entry.active_alert) {
              console.log("[useAlerts] ✅ Found active_alert from device:", key.slice(0, 8));
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
      channelManager.remove(channelName);
    };
  }, [effectiveUserId]);

  // ── 컴퓨터 경보음 원격 해제 ──
  const dismissRemoteAlarm = useCallback(async () => {
    const did = deviceIdRef.current;
    if (!did) throw new Error("No device selected");

    const userId = userIdRef.current;
    if (!userId) throw new Error("Login required");

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
        const timeout = setTimeout(() => reject(new Error("Channel connection timeout")), 5000);
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

    // ★ 직접 해제한 경보는 '읽음' 처리 — unreadCount에 포함되지 않도록
    if (id) {
      const currentAlerts = getAlertLogs(undefined, 50);
      for (const log of currentAlerts) {
        const alertId = (log.event_data as Record<string, unknown> | undefined)?.alertId as string | undefined;
        if (alertId === id && !log.is_read) {
          markLogAsRead(log.id);
        }
      }
    }

    Alarm.suppressFor(10000);
    if (lastAlertDeviceRef.current) {
      deviceSuppressRef.current.set(lastAlertDeviceRef.current, Date.now() + 120000);
      console.log("[useAlerts] 🛡️ Device suppressed:", lastAlertDeviceRef.current.slice(0, 8), "for 120s");
    }
    safeSetActiveAlert(null);
    activeAlertRef.current = null;
    lastAlertDeviceRef.current = null;
    loadAlerts(); // 읽음 처리 반영
    console.log("[useAlerts] ✅ All dismissed (suppress 10s, device 120s)");
  }, [safeSetActiveAlert, loadAlerts]);

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
