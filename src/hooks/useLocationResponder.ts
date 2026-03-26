import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { channelManager } from "@/lib/channelManager";
import { LAPTOP_DB_URL, LAPTOP_DB_ANON_KEY } from "@/lib/laptopDb";

/**
 * 스마트폰의 위치 응답 훅 (Realtime + Polling 하이브리드)
 * - Realtime postgres_changes로 즉시 감지 (빠른 경로)
 * - 10초 간격 폴링으로 Realtime 실패 시 폴백
 * - 타임스탬프가 감지되면 GPS 위치 획득 → DB 업데이트 → locate_requested를 null로 초기화
 */
export function useLocationResponder() {
  const { user, effectiveUserId } = useAuth();
  const { devices } = useDevices();
  const processingRef = useRef(false);
  const lastProcessedRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const smartphoneDevice = devices.find(
    (d) => d.device_type === "smartphone" && d.user_id === (effectiveUserId || user?.id)
  );

  // 앱 로드 시 위치 권한 미리 요청
  useEffect(() => {
    if (!smartphoneDevice) return;
    preRequestLocationPermission();
  }, [smartphoneDevice?.id]);

  // 위치 요청 처리 핵심 로직
  const handleLocateRequest = useCallback(async (deviceId: string, locateRequested: string) => {
    if (processingRef.current) return;
    if (lastProcessedRef.current === locateRequested) return;

    processingRef.current = true;
    lastProcessedRef.current = locateRequested;
    console.log("[LocationResponder] 📍 Location request detected:", locateRequested);

    try {
      const { position, source } = await getLocationWithFallback();
      const { latitude, longitude } = position.coords;

      console.log(`[LocationResponder] Location acquired (${source}):`, { latitude, longitude });

      await safeMetadataUpdate(
        deviceId,
        { locate_requested: null, location_source: source },
        { latitude, longitude, location_updated_at: new Date().toISOString() }
      );
      console.log("[LocationResponder] ✅ Location updated successfully (source:", source, ")");

      // 랩탑 로컬 DB에도 위치 응답 이중 쓰기 (fire-and-forget)
      try {
        const userId = effectiveUserId || user?.id;
        if (userId) {
          const res = await fetch(`${LAPTOP_DB_URL}/functions/v1/get-devices`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: LAPTOP_DB_ANON_KEY },
            body: JSON.stringify({ user_id: userId }),
          });
          if (res.ok) {
            const data = await res.json();
            const localDevices = data.devices || data || [];
            const localSmartphone = localDevices.find((d: any) => d.device_type === "smartphone");
            if (localSmartphone) {
              const localMeta = (localSmartphone.metadata as Record<string, unknown>) || {};
              await fetch(`${LAPTOP_DB_URL}/functions/v1/update-device`, {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: LAPTOP_DB_KEY },
                body: JSON.stringify({
                  device_id: localSmartphone.id,
                  updates: {
                    latitude,
                    longitude,
                    location_updated_at: new Date().toISOString(),
                    metadata: { ...localMeta, locate_requested: null, location_source: source },
                  },
                }),
              });
              console.log("[LocationResponder] ✅ Laptop local DB also updated");
            }
          }
        }
      } catch (e) {
        console.warn("[LocationResponder] Laptop DB update failed (non-critical):", e);
      }
    } catch (err) {
      console.error("[LocationResponder] All location methods failed:", err);
      await safeMetadataUpdate(deviceId, {
        locate_requested: null,
        locate_error: "All location methods failed",
        location_source: null,
      });
    } finally {
      processingRef.current = false;
    }
  }, [effectiveUserId, user?.id]);

  // Realtime 구독 (빠른 경로)
  useEffect(() => {
    if (!smartphoneDevice) return;

    const deviceId = smartphoneDevice.id;
    const channelName = `locate-cmd-${deviceId}`;

    console.log("[LocationResponder] Subscribing to:", channelName);

    channelManager.remove(channelName);
    const channel = channelManager.getOrCreate(channelName);

    channel
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${deviceId}`,
        },
        async (payload) => {
          const newData = payload.new as { metadata: Record<string, unknown> | null };
          const metadata = newData.metadata;
          if (!metadata || !metadata.locate_requested) return;
          await handleLocateRequest(deviceId, metadata.locate_requested as string);
        }
      )
      .subscribe((status) => {
        console.log("[LocationResponder] Channel status:", status);
      });

    return () => {
      channelManager.remove(channelName);
    };
  }, [smartphoneDevice?.id, handleLocateRequest]);

  // 폴링 폴백 (Realtime 실패 대비, 10초 간격)
  useEffect(() => {
    if (!smartphoneDevice) return;

    const deviceId = smartphoneDevice.id;

    const pollForLocateRequest = async () => {
      if (processingRef.current) return;

      try {
        const { data, error } = await supabase.functions.invoke("get-devices", {
          body: { device_id: deviceId },
        });
        if (error) return;

        const devicesList = data?.devices || [];
        const device = devicesList.find((d: any) => d.id === deviceId);
        const meta = device?.metadata as Record<string, unknown> | null;

        if (meta?.locate_requested && lastProcessedRef.current !== meta.locate_requested) {
          console.log("[LocationResponder] 🔄 Polling detected locate_requested:", meta.locate_requested);
          await handleLocateRequest(deviceId, meta.locate_requested as string);
        }
      } catch {
        // silent - polling failure is non-critical
      }
    };

    pollForLocateRequest();
    pollIntervalRef.current = setInterval(pollForLocateRequest, 10000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [smartphoneDevice?.id, handleLocateRequest]);
}

async function getLocationWithFallback(): Promise<{ position: GeolocationPosition; source: "gps" | "wifi" }> {
  try {
    const position = await getPosition(true, 10000);
    return { position, source: "gps" };
  } catch {
    console.warn("[LocationResponder] GPS failed, falling back to Wi-Fi/network");
  }
  const position = await getPosition(false, 15000);
  return { position, source: "wifi" };
}

function getPosition(highAccuracy: boolean, timeout: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: highAccuracy,
      timeout,
      maximumAge: 0,
    });
  });
}

async function preRequestLocationPermission() {
  try {
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "granted") {
        console.log("[LocationResponder] 📍 Location permission already granted");
        return;
      }
    }
    console.log("[LocationResponder] 📍 Pre-requesting location permission...");
    await getPosition(true, 5000);
    console.log("[LocationResponder] ✅ Location permission granted via pre-request");
  } catch (err) {
    console.warn("[LocationResponder] Pre-request failed (user may have denied):", err);
  }
}
