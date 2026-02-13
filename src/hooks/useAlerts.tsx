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
  const firstSyncDoneRef = useRef(false);

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
    // 전역 상태 체크 (window 기반 — 다중 번들 안전)
    if (Alarm.isDismissed(alert.id)) return;
    if (Alarm.isSuppressed()) return;

    // 60초 이상 된 stale alert 무시
    if (Date.now() - new Date(alert.created_at).getTime() > 60_000) {
      Alarm.addDismissed(alert.id);
      return;
    }

    // 이미 같은 alert가 활성 상태면 무시
    if (activeAlertRef.current?.id === alert.id) return;

    console.log("[useAlerts] 🚨 New alert (log only):", alert.id);

    // 경보 UI와 사운드는 usePhotoReceiver에서 전담
    // 여기서는 로컬 로그 기록만 수행

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
  }, [safeSetActiveAlert, loadAlerts]);

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
    firstSyncDoneRef.current = false;

    channel
      // 1. Presence sync — 랩탑이 track()으로 보낸 경보 상태 수신
      .on('presence', { event: 'sync' }, () => {
        if (!mountedRef.current) return;

        // 첫 sync는 stale alert일 수 있으므로 무시
        if (!firstSyncDoneRef.current) {
          firstSyncDoneRef.current = true;
          console.log("[useAlerts] First sync — skipping stale alerts");
          return;
        }

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
          handleAlert(foundAlert);
        }
      })
      // 2. Broadcast — 랩탑이 별도 전송하는 경보
      .on('broadcast', { event: 'active_alert' }, (payload) => {
        if (!mountedRef.current) return;
        const alert = payload?.payload?.active_alert as ActiveAlert | undefined;
        if (alert) handleAlert(alert);
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
  }, [deviceId, handleAlert]);

  // ── 스마트폰 경보음 해제 (로컬만) ──
  const dismissPhoneAlarm = useCallback(() => {
    Alarm.stop();
    Alarm.suppressFor(30_000);
    const id = activeAlertRef.current?.id;
    if (id) {
      Alarm.addDismissed(id);
      console.log("[useAlerts] ✅ Phone alarm dismissed:", id);
    }
    // UI(오버레이)는 유지 — 사용자가 확인 버튼으로 닫음
  }, []);

  // ── 컴퓨터 경보음 원격 해제 ──
  const dismissRemoteAlarm = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch) {
      console.warn("[useAlerts] No channel ref");
      throw new Error("채널 미연결");
    }

    // 채널이 아직 SUBSCRIBED가 아니면 최대 3초 대기
    if (!isSubscribedRef.current) {
      console.log("[useAlerts] Channel not subscribed yet, waiting...");
      let waited = 0;
      while (!isSubscribedRef.current && waited < 3000) {
        await new Promise(r => setTimeout(r, 300));
        waited += 300;
      }
      if (!isSubscribedRef.current) {
        console.warn("[useAlerts] Channel still not ready after 3s");
        throw new Error("채널 미연결");
      }
    }

    const dismissedAt = new Date().toISOString();

    // Broadcast (즉시 전달)
    await ch.send({
      type: 'broadcast',
      event: 'remote_alarm_off',
      payload: { dismissed_at: dismissedAt, dismissed_by: 'smartphone', remote_alarm_off: true },
    });

    // Presence (하위 호환 — 랩탑이 두 방식 모두 수신)
    await ch.track({
      role: 'phone',
      remote_alarm_off: true,
      active_alert: null,
      dismissed_at: dismissedAt,
    });

    console.log("[useAlerts] ✅ Remote alarm off sent:", dismissedAt);
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
    dismissPhoneAlarm,
    dismissRemoteAlarm,
    dismissAll,
    refreshAlerts: loadAlerts,
  };
};
