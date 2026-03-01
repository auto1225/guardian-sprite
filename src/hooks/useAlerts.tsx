/**
 * useAlerts — 스마트폰 경보 수신/해제 훅 (사용자 단일 채널)
 *
 * 채널 구조:
 *   - user-alerts-{userId} 단일 채널로 모든 기기의 경보를 수신
 *   - 경보 해제는 user-commands-{userId} 채널(통합 명령 프로토콜)로 전송
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
import { broadcastCommand } from "@/lib/broadcastCommand";
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
  // ★ Per-device 시간 기반 중복 방지 — 동일 기기에서 짧은 시간 내 다중 경보 수신 시 하나만 처리
  const deviceLastAlertTimeRef = useRef<Map<string, number>>(new Map());
  const DEVICE_DEDUP_WINDOW_MS = 10_000; // 10초

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
    // ★ Per-device suppression — 해제 직후 동일 경보의 Presence 잔류 방지
    // 단, 새로운 경보(다른 ID)는 억제하지 않음
    if (fromDeviceId) {
      const deviceSuppressUntil = deviceSuppressRef.current.get(fromDeviceId);
      if (deviceSuppressUntil && Date.now() < deviceSuppressUntil) {
        // 이미 dismissed된 알림만 억제 — 완전히 새로운 경보는 통과
        if (Alarm.isDismissed(alert.id) || isAlertIdProcessed(alert.id)) {
          console.log("[useAlerts] ⏭ Device suppressed (stale alert):", fromDeviceId.slice(0, 8));
          return;
        }
        console.log("[useAlerts] ⚠️ Device suppressed but NEW alert detected, allowing:", alert.id.slice(0, 8));
      }
    }

    const age = Date.now() - new Date(alert.created_at).getTime();
    if (age > 120_000) {
      console.log("[useAlerts] ⏭ Stale alert (age:", Math.round(age / 1000), "s), dismissing:", alert.id);
      Alarm.addDismissed(alert.id);
      return;
    }

    if (activeAlertRef.current?.id === alert.id) return;

    // ★ Per-device 시간 기반 중복 방지 — 같은 기기에서 10초 내 다중 경보 수신 시 하나만 처리
    if (fromDeviceId) {
      const lastTime = deviceLastAlertTimeRef.current.get(fromDeviceId);
      if (lastTime && Date.now() - lastTime < DEVICE_DEDUP_WINDOW_MS) {
        console.log("[useAlerts] ⏭ Device dedup (within 10s window):", fromDeviceId.slice(0, 8), "alert:", alert.id.slice(0, 8));
        addProcessedAlertId(alert.id);
        return;
      }
    }

    console.log("[useAlerts] 🚨 New alert:", alert.id, "from device:", fromDeviceId?.slice(0, 8), "age:", Math.round(age / 1000), "s");
    activeAlertRef.current = alert;
    lastAlertDeviceRef.current = fromDeviceId || null;
    if (fromDeviceId) {
      deviceLastAlertTimeRef.current.set(fromDeviceId, Date.now());
    }
    safeSetActiveAlert(alert);

    if (!Alarm.isPlaying() && !Alarm.isMuted()) {
      console.log("[useAlerts] 🔊 Starting alarm sound...");
      Alarm.play();
    } else {
      console.log("[useAlerts] ⏭ Alarm already playing or muted, skipping play");
    }

    // ★ 항상 선택된 기기 ID(DB 기준)로 저장 — Presence key(크로스 프로젝트 ID)가 아닌 공유 DB의 기기 ID 사용
    const logDeviceId = deviceIdRef.current || fromDeviceId;
    if (logDeviceId) {
      try {
        // 처리 완료 등록 — 이후 Presence sync에서 재생성 차단
        addProcessedAlertId(alert.id);
        // ★ event_type을 "security_alert"로 저장 — getAlertLogs의 excludeTypes에 "intrusion"이 포함되어 필터링되는 문제 방지
        addActivityLog(logDeviceId, "security_alert", {
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

  // ── 컴퓨터 경보음 원격 해제 (통합 명령 채널 사용) ──
  const dismissRemoteAlarm = useCallback(async () => {
    const did = deviceIdRef.current;
    if (!did) throw new Error("No device selected");

    const userId = userIdRef.current;
    if (!userId) throw new Error("Login required");

    const dismissPayload = {
      device_id: did,
      dismissed_at: new Date().toISOString(),
      dismissed_by: 'smartphone',
      remote_alarm_off: true,
    };

    // ★ 통합 명령 채널(user-commands)로 전송 — 노트북이 확실히 수신
    await broadcastCommand({
      userId,
      event: "alarm_dismiss",
      payload: dismissPayload,
    });

    // ★ user-alerts 채널에도 동시 전송 (하위 호환)
    if (channelRef.current && isSubscribedRef.current) {
      try {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'remote_alarm_off',
          payload: dismissPayload,
        });
      } catch (err) {
        console.warn("[useAlerts] user-alerts fallback send failed:", err);
      }
    }

    console.log("[useAlerts] ✅ Remote alarm off sent via user-commands + user-alerts:", dismissPayload.dismissed_at);
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

    Alarm.suppressFor(5000); // 5초 전역 억제 (Presence 잔류 데이터 방지)
    if (lastAlertDeviceRef.current) {
      deviceSuppressRef.current.set(lastAlertDeviceRef.current, Date.now() + 30000); // 30초 기기 억제
      console.log("[useAlerts] 🛡️ Device suppressed:", lastAlertDeviceRef.current.slice(0, 8), "for 30s");
    }
    safeSetActiveAlert(null);
    activeAlertRef.current = null;
    lastAlertDeviceRef.current = null;
    loadAlerts();
    console.log("[useAlerts] ✅ All dismissed (suppress 5s, device 30s)");
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
