/**
 * useAlerts — 스마트폰 경보 수신/해제 훅
 *
 * 컴퓨터(랩탑)의 useAlerts.ts 구조를 참고하여 깔끔하게 재작성.
 * 핵심 원칙:
 *   1. 채널은 하나만 구독 (device-alerts-${deviceId})
 *   2. Presence sync로 경보 수신, Broadcast로 원격 해제
 *   3. 모든 dismiss/suppress 상태는 window 전역 (다중 번들 안전)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  addActivityLog,
  getAlertLogs,
  markLogAsRead,
  markAllLogsAsRead,
  LocalActivityLog,
  LocalAlertType,
} from "@/lib/localActivityLogs";
import * as Alarm from "@/lib/alarmSound";

// 모듈 로드 시 레거시 정리는 alarmSound.ts 내부에서 자동 처리됨

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
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSubscribedRef = useRef(false);
  const mountedRef = useRef(true);
  const deviceIdRef = useRef(deviceId);
  const activeAlertRef = useRef<ActiveAlert | null>(null);
  const handleAlertRef = useRef<(alert: ActiveAlert) => void>(() => {});

  deviceIdRef.current = deviceId;

  // ── safe setState ──
  const safe = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (v: T) => { if (mountedRef.current) try { setter(v); } catch {} };
  const safeSetAlerts = useCallback(safe(setAlerts), []);
  const safeSetActiveAlert = useCallback(safe(setActiveAlert), []);
  const safeSetIsLoading = useCallback(safe(setIsLoading), []);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── 로컬 로그 로드 ──
  const loadAlerts = useCallback(() => {
    const did = deviceIdRef.current;
    if (!did) { safeSetAlerts([]); safeSetIsLoading(false); return; }
    safeSetAlerts(getAlertLogs(did, 50));
    safeSetIsLoading(false);
  }, [safeSetAlerts, safeSetIsLoading]);

  useEffect(() => { loadAlerts(); }, [deviceId]);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  // ── 경보 수신 처리 ──
  const handleAlert = useCallback((alert: ActiveAlert) => {
    if (Alarm.isDismissed(alert.id)) return;
    if (Alarm.isSuppressed()) return;

    // 60초 이상 된 stale alert 무시
    if (Date.now() - new Date(alert.created_at).getTime() > 60_000) {
      Alarm.addDismissed(alert.id);
      return;
    }

    // 이미 같은 alert가 활성 상태면 무시
    if (activeAlertRef.current?.id === alert.id) return;

    console.log("[useAlerts] 🚨 New alert:", alert.id);
    activeAlertRef.current = alert;

    // 경보음 재생
    if (!Alarm.isPlaying() && !Alarm.isMuted()) {
      Alarm.play();
    }

    // 로컬 로그에 기록
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
  }, [loadAlerts]);

  // ref로 최신 handleAlert를 유지 — 채널 의존성에서 제거
  handleAlertRef.current = handleAlert;

  // ── 채널 구독 ──
  useEffect(() => {
    if (!deviceId) return;

    const channelName = `device-alerts-${deviceId}`;

    // 기존 동일 토픽 채널 정리
    const existing = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existing) supabase.removeChannel(existing);

    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    isSubscribedRef.current = false;

    channel
      // 1. Presence sync — 랩탑이 track()으로 보낸 경보 상태 수신
      .on('presence', { event: 'sync' }, () => {
        if (!mountedRef.current) return;

        const state = channel.presenceState();

        let foundAlert: ActiveAlert | null = null;
        for (const key of Object.keys(state)) {
          const entries = state[key] as Array<{
            active_alert?: ActiveAlert | null;
            status?: string;
          }>;
          for (const entry of entries) {
            if (entry.status === 'listening') continue;
            if (entry.active_alert) {
              foundAlert = entry.active_alert;
              break;
            }
          }
          if (foundAlert) break;
        }

        if (foundAlert) {
          handleAlertRef.current(foundAlert);
        }
      })
      // 2. Broadcast — 랩탑이 별도 전송하는 경보
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) handleAlertRef.current(alert);
      })
      // 3. remote_alarm_off — 이 이벤트는 스마트폰→랩탑 방향이므로 phone에서는 무시
      .on('broadcast', { event: 'remote_alarm_off' }, () => {
        // no-op on phone
      })
      .subscribe(async (status) => {
        console.log("[useAlerts] Channel:", status);
        if (status === 'SUBSCRIBED' && mountedRef.current) {
          isSubscribedRef.current = true;
          
          await channel.track({ role: 'phone', joined_at: new Date().toISOString() });
        } else {
          isSubscribedRef.current = false;
        }
      });

    return () => {
      isSubscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [deviceId]); // handleAlert 제거 — ref로 대체


  // ── 컴퓨터 경보음 원격 해제 ──
  const dismissRemoteAlarm = useCallback(async () => {
    const did = deviceIdRef.current;
    if (!did) throw new Error("디바이스 미선택");

    const channelName = `device-alerts-${did}`;

    // 메인 채널이 살아있으면 바로 전송
    if (channelRef.current && isSubscribedRef.current) {
      const dismissedAt = new Date().toISOString();
      await channelRef.current.send({
        type: 'broadcast',
        event: 'remote_alarm_off',
        payload: { dismissed_at: dismissedAt, dismissed_by: 'smartphone', remote_alarm_off: true },
      });
      console.log("[useAlerts] ✅ Remote alarm off sent (main channel):", dismissedAt);
      return;
    }

    // 메인 채널이 죽었으면 → 기존 제거 후 새 채널 생성
    console.log("[useAlerts] Main channel dead, creating fresh channel");
    const existing = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existing) supabase.removeChannel(existing);

    const freshChannel = supabase.channel(channelName);

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("채널 연결 시간 초과")), 5000);
        freshChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') { clearTimeout(timeout); reject(new Error(status)); }
        });
      });

      const dismissedAt = new Date().toISOString();
      await freshChannel.send({
        type: 'broadcast',
        event: 'remote_alarm_off',
        payload: { dismissed_at: dismissedAt, dismissed_by: 'smartphone', remote_alarm_off: true },
      });

      // 새 채널을 메인으로 승격
      channelRef.current = freshChannel;
      isSubscribedRef.current = true;
      console.log("[useAlerts] ✅ Remote alarm off sent (fresh channel):", dismissedAt);
    } catch (err) {
      supabase.removeChannel(freshChannel);
      throw err;
    }
  }, []);

  // ── 전체 해제 (스마트폰 UI 닫기) ──
  const dismissAll = useCallback(() => {
    Alarm.stop();
    Alarm.suppressFor(30_000);
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
    markAllAsRead: { mutate: () => { const d = deviceIdRef.current; if (d) { markAllLogsAsRead(d); loadAlerts(); } } },
    dismissRemoteAlarm,
    dismissAll,
    refreshAlerts: loadAlerts,
  };
};
