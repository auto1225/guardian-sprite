import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  PhotoAlert,
  PhotoEventType,
  savePhotoAlert,
  getPhotoAlerts,
  deletePhotoAlert,
  markPhotoAlertRead,
} from "@/lib/photoAlertStorage";
import { deleteAlertVideo } from "@/lib/alertVideoStorage";

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

    // 기존 동일 토픽 채널 정리
    const existing = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existing) supabase.removeChannel(existing);

    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "photo_alert_start" }, ({ payload }) => {
        const deviceId = payload.device_id;
        console.log("[PhotoReceiver] Start from device:", deviceId?.slice(0, 8), payload);
        pendingRef.current = {
          id: payload.id,
          device_id: deviceId,
          device_name: deviceNameMap?.[deviceId] || payload.device_name,
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
        setLatestAlert(completed);
        loadAlerts();
      })
      .subscribe((status) => {
        console.log("[PhotoReceiver] Channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user?.id, deviceNameMap, loadAlerts]);

  const dismissLatest = useCallback(() => {
    if (latestAlert) {
      markPhotoAlertRead(latestAlert.id);
      loadAlerts();
    }
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
