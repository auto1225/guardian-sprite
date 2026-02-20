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

interface PendingSequence {
  id: string;
  device_id: string;
  device_name?: string;
  event_type: PhotoEventType;
  change_percent?: number;
  created_at: string;
  total_chunks: number;
  received_chunks: number;
  photos: string[];
  // photo_alert_end payload extras
  latitude?: number | null;
  longitude?: number | null;
  location_source?: string | null;
  auto_streaming?: boolean;
  completed: boolean;
}

interface PendingBatch {
  batch_id: string;
  batch_total: number; // 이 배치에서 기대하는 총 시퀀스 수
  sequences: Map<string, PendingSequence>; // sequence id → data
  completed_count: number;
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
 * usePhotoReceiver — 사진 경보 수신 훅 (배치 프로토콜)
 *
 * 프로토콜 v9:
 *   - photo_alert_start에 batch_id, batch_total 포함
 *   - 같은 batch_id의 모든 시퀀스가 완료될 때까지 오버레이 표시 대기
 *   - 30초 시간 기반 억제 제거 → 배치 완료 기반으로 전환
 *
 * 하위 호환성:
 *   - batch_id/batch_total이 없는 레거시 전송은 단일 배치(batch_total=1)로 처리
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
  const batchRef = useRef<Map<string, PendingBatch>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const deviceNameMapRef = useRef(deviceNameMap);
  deviceNameMapRef.current = deviceNameMap;

  const loadAlerts = useCallback(() => {
    setAlerts(getPhotoAlerts());
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  /** 배치 완료 시 호출 — 모든 사진을 하나의 PhotoAlert로 병합 후 오버레이 표시 */
  const finalizeBatch = useCallback((batch: PendingBatch) => {
    const allPhotos: string[] = [];
    let firstSeq: PendingSequence | null = null;
    let lastLatitude: number | null = null;
    let lastLongitude: number | null = null;
    let lastLocationSource: string | null = null;
    let lastAutoStreaming = false;

    // 시퀀스를 생성 시간순으로 정렬하여 사진 순서 보장
    const sequences = Array.from(batch.sequences.values())
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const seq of sequences) {
      if (!firstSeq) firstSeq = seq;
      allPhotos.push(...seq.photos);
      if (seq.latitude != null) lastLatitude = seq.latitude;
      if (seq.longitude != null) lastLongitude = seq.longitude;
      if (seq.location_source) lastLocationSource = seq.location_source;
      if (seq.auto_streaming) lastAutoStreaming = true;
    }

    if (!firstSeq) return;

    const completed: PhotoAlert = {
      id: batch.batch_id, // 배치 ID를 경보 ID로 사용
      device_id: firstSeq.device_id,
      device_name: firstSeq.device_name,
      event_type: firstSeq.event_type,
      total_photos: allPhotos.length,
      change_percent: firstSeq.change_percent,
      photos: allPhotos,
      created_at: firstSeq.created_at,
      is_read: false,
      latitude: lastLatitude,
      longitude: lastLongitude,
      location_source: lastLocationSource,
      auto_streaming: lastAutoStreaming,
    };

    savePhotoAlert(completed);
    setLatestAlert(completed);
    loadAlerts();
    setReceiving(false);
    setProgress(100);

    // 배치 정리
    batchRef.current.delete(batch.batch_id);
    console.log("[PhotoReceiver] ✅ Batch complete:", batch.batch_id, "total photos:", allPhotos.length);
  }, [loadAlerts]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    const channelName = `user-photos-${userId}`;
    console.log("[PhotoReceiver] Subscribing to:", channelName);

    channelManager.remove(channelName);
    const channel = channelManager.getOrCreate(channelName);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "photo_alert_start" }, ({ payload }) => {
        const deviceId = payload.device_id;
        // 하위 호환: batch_id가 없으면 sequence id를 batch_id로 사용
        const batchId = payload.batch_id || payload.id;
        const batchTotal = payload.batch_total || 1;

        console.log("[PhotoReceiver] Start — batch:", batchId, "seq:", payload.id,
          "batch_total:", batchTotal, "device:", deviceId?.slice(0, 8));

        // 배치가 없으면 생성
        if (!batchRef.current.has(batchId)) {
          batchRef.current.set(batchId, {
            batch_id: batchId,
            batch_total: batchTotal,
            sequences: new Map(),
            completed_count: 0,
          });
        }

        const batch = batchRef.current.get(batchId)!;
        // batch_total 갱신 (이후 시퀀스에서 더 정확한 값이 올 수 있음)
        if (batchTotal > batch.batch_total) {
          batch.batch_total = batchTotal;
        }

        batch.sequences.set(payload.id, {
          id: payload.id,
          device_id: deviceId,
          device_name: deviceNameMapRef.current?.[deviceId] || payload.device_name,
          event_type: payload.event_type,
          change_percent: payload.change_percent,
          created_at: payload.created_at,
          total_chunks: Math.ceil(payload.total_photos / 2),
          received_chunks: 0,
          photos: [],
          completed: false,
        });

        setReceiving(true);
        setProgress(0);
      })
      .on("broadcast", { event: "photo_alert_chunk" }, ({ payload }) => {
        // 모든 배치에서 해당 시퀀스 찾기
        for (const batch of batchRef.current.values()) {
          const seq = batch.sequences.get(payload.id);
          if (seq) {
            seq.photos.push(...payload.photos);
            seq.received_chunks++;

            // 전체 배치 진행률 계산
            let totalChunks = 0;
            let receivedChunks = 0;
            for (const s of batch.sequences.values()) {
              totalChunks += s.total_chunks;
              receivedChunks += s.received_chunks;
            }
            // 아직 도착 안 한 시퀀스 분량 추정
            const remainingSeqs = batch.batch_total - batch.sequences.size;
            totalChunks += remainingSeqs * (seq.total_chunks || 1);

            setProgress(Math.round((receivedChunks / Math.max(totalChunks, 1)) * 100));
            break;
          }
        }
      })
      .on("broadcast", { event: "photo_alert_end" }, ({ payload }) => {
        for (const batch of batchRef.current.values()) {
          const seq = batch.sequences.get(payload.id);
          if (seq && !seq.completed) {
            seq.completed = true;
            seq.latitude = payload.latitude ?? null;
            seq.longitude = payload.longitude ?? null;
            seq.location_source = payload.location_source ?? null;
            seq.auto_streaming = payload.auto_streaming ?? false;
            batch.completed_count++;

            console.log("[PhotoReceiver] Seq complete:", payload.id,
              `(${batch.completed_count}/${batch.batch_total})`);

            // 모든 시퀀스 완료 → 배치 확정, 오버레이 1회 표시
            if (batch.completed_count >= batch.batch_total) {
              finalizeBatch(batch);
            }
            break;
          }
        }
      })
      .subscribe((status) => {
        console.log("[PhotoReceiver] Channel status:", status);
      });

    return () => {
      channelManager.remove(channelName);
      channelRef.current = null;
    };
  }, [user?.id, loadAlerts, finalizeBatch]);

  const dismissLatest = useCallback(() => {
    if (latestAlert) {
      Alarm.addDismissed(latestAlert.id);
      markPhotoAlertRead(latestAlert.id);
      loadAlerts();
    }
    Alarm.stop();
    Alarm.suppressFor(60000);
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
