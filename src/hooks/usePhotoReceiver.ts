import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PhotoAlert,
  PhotoEventType,
  savePhotoAlert,
  getPhotoAlerts,
  deletePhotoAlert,
  markPhotoAlertRead,
} from "@/lib/photoAlertStorage";

interface PendingAlert {
  id: string;
  device_id: string;
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

export function usePhotoReceiver(deviceId: string | null | undefined): UsePhotoReceiverReturn {
  const [receiving, setReceiving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [latestAlert, setLatestAlert] = useState<PhotoAlert | null>(null);
  const [viewingAlert, setViewingAlert] = useState<PhotoAlert | null>(null);
  const [alerts, setAlerts] = useState<PhotoAlert[]>([]);
  const pendingRef = useRef<PendingAlert | null>(null);

  const loadAlerts = useCallback(() => {
    if (!deviceId) {
      setAlerts([]);
      return;
    }
    setAlerts(getPhotoAlerts(deviceId));
  }, [deviceId]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (!deviceId) return;

    const channelName = `device-photos-${deviceId}`;
    console.log("[PhotoReceiver] Subscribing to:", channelName);

    const channel = supabase.channel(channelName);

    channel
      .on("broadcast", { event: "photo_alert_start" }, ({ payload }) => {
        console.log("[PhotoReceiver] Start:", payload);
        pendingRef.current = {
          id: payload.id,
          device_id: payload.device_id,
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
          event_type: pending.event_type,
          total_photos: pending.photos.length,
          change_percent: pending.change_percent,
          photos: pending.photos,
          created_at: pending.created_at,
          is_read: false,
        };

        savePhotoAlert(completed);
        pendingRef.current = null;
        setReceiving(false);
        setProgress(100);
        setLatestAlert(completed);
        loadAlerts();

        // Play alert sound
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = "square";
          gain.gain.value = 0.3;
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.frequency.value = 1100;
            osc2.type = "square";
            gain2.gain.value = 0.3;
            osc2.start();
            osc2.stop(ctx.currentTime + 0.3);
          }, 350);
        } catch {
          // Audio not available
        }
      })
      .subscribe((status) => {
        console.log("[PhotoReceiver] Channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, loadAlerts]);

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
