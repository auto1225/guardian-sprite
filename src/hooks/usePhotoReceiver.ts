import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { channelManager } from "@/lib/channelManager";
import {
  PhotoAlert,
  PhotoEventType,
  savePhotoAlert,
  getPhotoAlerts,
  deletePhotoAlert,
  markPhotoAlertRead,
} from "@/lib/photoAlertStorage";
import { deleteAlertVideo } from "@/lib/alertVideoStorage";
import * as Alarm from "@/lib/alarmSound";

interface PendingAlert {
  id: string;
  device_id: string;
  device_name?: string;
  event_type: PhotoEventType;
  total_photos: number;
  change_percent?: number;
  created_at: string;
  total_chunks: number;
  received_chunks: number;
  photos: string[];
}

interface UsePhotoReceiverReturn {
  receiving: boolean;
  progress: number;
  latestAlert: PhotoAlert | null;
  alerts: PhotoAlert[];
  dismissLatest: () => void;
  viewAlert: (alert: PhotoAlert) => void;
  viewingAlert: PhotoAlert | null;
  dismissViewing: () => void;
  removeAlert: (alertId: string) => void;
  refreshAlerts: () => void;
}

/**
 * usePhotoReceiver — 사진 경보 수신 훅 (사용자 단일 채널)
 *
 * 채널: user-photos-{userId} 하나로 모든 기기의 사진을 수신
 *
 * 🔧 FIX v7: 경보음 재생 책임을 useAlerts에 일원화
 *   - 이전: photo_alert_start, photo_alert_end에서 각각 Alarm.play() 독립 호출
 *   - 문제: useAlerts의 Presence Alert와 ID가 달라 dismiss 후 재트리거
 *   - 수정: 이 훅에서는 Alarm.play()를 직접 호출하지 않음
 *          경보음은 useAlerts의 Presence 채널을 통해서만 트리거됨
 */
export function usePhotoReceiver(
  selectedDeviceId: string | null | undefined,
  deviceNameMap?: Record<string, string>
): UsePhotoReceiverReturn {
  const { user } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [latestAlert, setLatestAlert] = useState<PhotoAlert | null>(null);
  const [viewingAlert, setViewingAlert] = useState<PhotoAlert | null>(null);
  const [alerts, setAlerts] = useState<PhotoAlert[]>([]);
  const pendingRef = useRef<PendingAlert | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const deviceNameMapRef = useRef(deviceNameMap);
  deviceNameMapRef.current = deviceNameMap;
  // 🔧 FIX v8: dismiss 후 일정 시간 동안 새 사진 경보 오버레이 표시 억제
  const overlaySuppressionRef = useRef<number>(0);

  const loadAlerts = useCallback(() => {
    setAlerts(getPhotoAlerts());
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    const channelName = `user-photos-${userId}`;
    console.log("[PhotoReceiver] Subscribing to:", channelName);

    // ChannelManager로 중복 방지
    channelManager.remove(channelName);
    const channel = channelManager.getOrCreate(channelName);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "photo_alert_start" }, ({ payload }) => {
        const deviceId = payload.device_id;
        console.log("[PhotoReceiver] Start from device:", deviceId?.slice(0, 8), payload);
        pendingRef.current = {
          id: payload.id,
          device_id: deviceId,
          device_name: deviceNameMapRef.current?.[deviceId] || payload.device_name,
          event_type: payload.event_type,
          total_photos: payload.total_photos,
          change_percent: payload.change_percent,
          created_at: payload.created_at,
          total_chunks: Math.ceil(payload.total_photos / 2),
          received_chunks: 0,
          photos: [],
        };
        setReceiving(true);
        setProgress(0);

        // 🔧 FIX v7: Alarm.play() 제거
        // 경보음은 useAlerts의 Presence 채널을 통해서만 트리거됩니다.
        // 여기서 독립적으로 play()를 호출하면:
        //   1. useAlerts의 Presence Alert ID와 다른 Photo Alert ID를 사용
        //   2. dismiss 시 Presence ID만 dismissed 처리되고 Photo ID는 남음
        //   3. suppress 기간 후 Photo ID로 다시 play()가 트리거됨
        // → 경보음 해제 불가 버그의 직접적 원인이었음
        console.log("[PhotoReceiver] 📸 Photo alert start (alarm delegated to useAlerts):", payload.id);
      })
      .on("broadcast", { event: "photo_alert_chunk" }, ({ payload }) => {
        const pending = pendingRef.current;
        if (!pending || pending.id !== payload.id) return;

        console.log(`[PhotoReceiver] Chunk ${payload.chunk_index + 1}/${payload.total_chunks}`);
        pending.photos.push(...payload.photos);
        pending.received_chunks++;
        setProgress(Math.round((pending.received_chunks / pending.total_chunks) * 100));
      })
      .on("broadcast", { event: "photo_alert_end" }, ({ payload }) => {
        const pending = pendingRef.current;
        if (!pending || pending.id !== payload.id) return;

        console.log("[PhotoReceiver] Complete:", payload.total_photos, "photos");

        const completed: PhotoAlert = {
          id: pending.id,
          device_id: pending.device_id,
          device_name: pending.device_name,
          event_type: pending.event_type,
          total_photos: pending.photos.length,
          change_percent: pending.change_percent,
          photos: pending.photos,
          created_at: pending.created_at,
          is_read: false,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          location_source: payload.location_source ?? null,
          auto_streaming: payload.auto_streaming ?? false,
        };

        savePhotoAlert(completed);
        pendingRef.current = null;
        setReceiving(false);
        setProgress(100);
        
        // 🔧 FIX v8: suppress 기간 중에는 오버레이를 다시 열지 않음
        if (Date.now() < overlaySuppressionRef.current) {
          console.log("[PhotoReceiver] 📸 Overlay suppressed, skipping setLatestAlert:", completed.id);
        } else {
          setLatestAlert(completed);
        }
        loadAlerts();

        // 🔧 FIX v7: Alarm.play() 제거 (위와 동일한 이유)
        console.log("[PhotoReceiver] 📸 Photo alert complete (alarm delegated to useAlerts):", completed.id);
      })
      .subscribe((status) => {
        console.log("[PhotoReceiver] Channel status:", status);
      });

    return () => {
      channelManager.remove(channelName);
      channelRef.current = null;
    };
  }, [user?.id, loadAlerts]);

  const dismissLatest = useCallback(() => {
    if (latestAlert) {
      Alarm.addDismissed(latestAlert.id);
      markPhotoAlertRead(latestAlert.id);
      loadAlerts();
    }
    Alarm.stop();
    Alarm.suppressFor(30000);
    // 🔧 FIX v8: 30초간 새 사진 경보 오버레이 표시 억제
    overlaySuppressionRef.current = Date.now() + 30000;
    setLatestAlert(null);
  }, [latestAlert, loadAlerts]);

  const viewAlert = useCallback(
    (alert: PhotoAlert) => {
      markPhotoAlertRead(alert.id);
      setViewingAlert(alert);
      loadAlerts();
    },
    [loadAlerts]
  );

  const dismissViewing = useCallback(() => {
    setViewingAlert(null);
  }, []);

  const removeAlert = useCallback(
    (alertId: string) => {
      deletePhotoAlert(alertId);
      deleteAlertVideo(alertId).catch(() => {});
      if (viewingAlert?.id === alertId) setViewingAlert(null);
      if (latestAlert?.id === alertId) setLatestAlert(null);
      loadAlerts();
    },
    [viewingAlert, latestAlert, loadAlerts]
  );

  return {
    receiving,
    progress,
    latestAlert,
    alerts,
    dismissLatest,
    viewAlert,
    viewingAlert,
    dismissViewing,
    removeAlert,
    refreshAlerts: loadAlerts,
  };
}
