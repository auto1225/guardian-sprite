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

export const useAlerts = (deviceId?: string | null, allDeviceIds?: string[]) => {
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSubscribedRef = useRef(false);
  const mountedRef = useRef(true);
  const deviceIdRef = useRef(deviceId);
  const activeAlertRef = useRef<ActiveAlert | null>(null);
  const handleAlertRef = useRef<(alert: ActiveAlert, fromDeviceId?: string) => void>(() => {});

  deviceIdRef.current = deviceId;

  // ── safe setState ──
  const safe = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (v: T) => { if (mountedRef.current) try { setter(v); } catch {} };
  const safeSetAlerts = useCallback(safe(setAlerts), []);
  const safeSetActiveAlert = useCallback(safe(setActiveAlert), []);
  const safeSetIsLoading = useCallback(safe(setIsLoading), []);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── 로컬 로그 로드 (모든 기기) ──
  const loadAlerts = useCallback(() => {
    // deviceId 없으면 전체 로그 로드
    safeSetAlerts(getAlertLogs(undefined, 50));
    safeSetIsLoading(false);
  }, [safeSetAlerts, safeSetIsLoading]);

  useEffect(() => { loadAlerts(); }, [deviceId]);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  // ── 경보 수신 처리 ──
  const handleAlert = useCallback((alert: ActiveAlert, fromDeviceId?: string) => {
    // 음소거 상태면 경보 전체 무시 (UI + 소리 모두)
    if (Alarm.isMuted()) return;
    if (Alarm.isDismissed(alert.id)) return;
    if (Alarm.isSuppressed()) return;

    const alertTime = new Date(alert.created_at).getTime();

    // stop() 이후에 생성된 경보만 허용 — 이전 경보 재트리거 차단
    if (alertTime <= Alarm.getLastStoppedAt()) {
      console.log("[useAlerts] ⏭ Alert created before last stop, ignoring:", alert.id);
      return;
    }

    // 60초 이상 된 stale alert 무시
    if (Date.now() - alertTime > 60_000) {
      Alarm.addDismissed(alert.id);
      return;
    }

    // 이미 같은 alert가 활성 상태면 무시
    if (activeAlertRef.current?.id === alert.id) return;

    console.log("[useAlerts] 🚨 New alert:", alert.id, "from device:", fromDeviceId?.slice(0, 8));
    activeAlertRef.current = alert;
    safeSetActiveAlert(alert); // ← 핵심 수정: AlertMode 오버레이 표시

    // 경보음 재생
    if (!Alarm.isPlaying() && !Alarm.isMuted()) {
      Alarm.play();
    }

    // 로컬 로그에 기록 — fromDeviceId가 있으면 해당 기기 ID로 기록
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

  // ref로 최신 handleAlert를 유지 — 채널 의존성에서 제거
  handleAlertRef.current = handleAlert;

  // ── 채널 구독 (모든 기기) ──
  const allIdsRef = useRef<string[]>([]);
  const channelsRef = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map());

  useEffect(() => {
    const ids = allDeviceIds && allDeviceIds.length > 0 ? allDeviceIds : (deviceId ? [deviceId] : []);
    if (ids.length === 0) return;

    // 변경 없으면 스킵
    const sortedIds = [...ids].sort().join(',');
    const prevIds = [...allIdsRef.current].sort().join(',');
    if (sortedIds === prevIds && channelsRef.current.size > 0) return;
    allIdsRef.current = ids;

    // 기존 채널 정리
    channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelsRef.current.clear();
    channelRef.current = null;
    isSubscribedRef.current = false;

    for (const did of ids) {
      const channelName = `device-alerts-${did}`;

      // 기존 동일 토픽 채널 정리
      const existing = supabase.getChannels().find(
        ch => ch.topic === `realtime:${channelName}`
      );
      if (existing) supabase.removeChannel(existing);

      const channel = supabase.channel(channelName);
      channelsRef.current.set(did, channel);

      // 현재 선택된 기기의 채널을 메인으로 설정
      if (did === deviceId) {
        channelRef.current = channel;
      }

      channel
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
          if (foundAlert) handleAlertRef.current(foundAlert, did);
        })
        .on('broadcast', { event: 'active_alert' }, (payload) => {
          if (!mountedRef.current) return;
          const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
          if (alert) handleAlertRef.current(alert, did);
        })
        .on('broadcast', { event: 'remote_alarm_off' }, () => {})
        .subscribe(async (status) => {
          console.log(`[useAlerts] Channel ${did.slice(0, 8)}:`, status);
          if (status === 'SUBSCRIBED' && mountedRef.current) {
            if (did === deviceIdRef.current) {
              isSubscribedRef.current = true;
            }
            await channel.track({ role: 'phone', joined_at: new Date().toISOString() });
          }
        });
    }

    return () => {
      isSubscribedRef.current = false;
      channelRef.current = null;
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current.clear();
    };
  }, [deviceId, allDeviceIds?.join(',')]); // allDeviceIds 변경 시 재구독


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
    Alarm.stop();           // isAlarming=false, pendingPlay=false, gen++, lastStoppedAt=now+1s
    // suppressFor 제거 — Presence sync는 한 번만 발생하므로 억제하면 새 경보가 영구 누락됨
    // addDismissed + lastStoppedAt으로 동일 경보 재트리거는 충분히 차단됨
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
