import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { Json } from "@/integrations/supabase/types";

/**
 * 스마트폰의 위치 응답 훅
 * - 앱 로드 시 위치 권한을 미리 요청 (오버레이 차단 방지)
 * - 자신의 devices 레코드의 metadata.locate_requested를 실시간 감시
 * - 타임스탬프가 감지되면 GPS 위치 획득 → DB 업데이트 → locate_requested를 null로 초기화
 */
export function useLocationResponder() {
  const { user } = useAuth();
  const { devices } = useDevices();
  const processingRef = useRef(false);

  // 현재 유저의 스마트폰 디바이스 찾기
  const smartphoneDevice = devices.find(
    (d) => d.device_type === "smartphone" && d.user_id === user?.id
  );

  // 앱 로드 시 위치 권한 미리 요청 — 오버레이 위에서 권한 다이얼로그 차단 방지
  useEffect(() => {
    if (!smartphoneDevice) return;
    preRequestLocationPermission();
  }, [smartphoneDevice?.id]);

  useEffect(() => {
    if (!smartphoneDevice) return;

    const deviceId = smartphoneDevice.id;
    const channelName = `locate-cmd-${deviceId}`;

    console.log("[LocationResponder] Subscribing to:", channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${deviceId}`,
        },
        async (payload) => {
          const newData = payload.new as {
            metadata: Record<string, unknown> | null;
          };
          const metadata = newData.metadata;

          if (!metadata || !metadata.locate_requested) return;
          if (processingRef.current) return;

          processingRef.current = true;
          console.log("[LocationResponder] 📍 Location request detected:", metadata.locate_requested);

          try {
            const { position, source } = await getLocationWithFallback();
            const { latitude, longitude } = position.coords;

            console.log(`[LocationResponder] Location acquired (${source}):`, { latitude, longitude });

            const existingMeta = metadata as Record<string, unknown>;
            const updatedMeta: Record<string, unknown> = {
              ...existingMeta,
              locate_requested: null,
              location_source: source,
            };

            const { error } = await supabase
              .from("devices")
              .update({
                latitude,
                longitude,
                location_updated_at: new Date().toISOString(),
                metadata: updatedMeta as unknown as Json,
              })
              .eq("id", deviceId);

            if (error) {
              console.error("[LocationResponder] DB update failed:", error);
            } else {
              console.log("[LocationResponder] ✅ Location updated successfully (source:", source, ")");
            }
          } catch (err) {
            console.error("[LocationResponder] All location methods failed:", err);

            const existingMeta = (metadata as Record<string, unknown>) || {};
            await supabase
              .from("devices")
              .update({
                metadata: {
                  ...existingMeta,
                  locate_requested: null,
                  locate_error: "All location methods failed",
                  location_source: null,
                } as unknown as Json,
              })
              .eq("id", deviceId);
          } finally {
            processingRef.current = false;
          }
        }
      )
      .subscribe((status) => {
        console.log("[LocationResponder] Channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [smartphoneDevice?.id]);
}

async function getLocationWithFallback(): Promise<{ position: GeolocationPosition; source: "gps" | "wifi" }> {
  // 1순위: GPS (High Accuracy)
  try {
    const position = await getPosition(true, 10000);
    return { position, source: "gps" };
  } catch {
    console.warn("[LocationResponder] GPS failed, falling back to Wi-Fi/network");
  }

  // 2순위: Wi-Fi/네트워크 위치
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

/**
 * 앱 초기 로드 시 위치 권한을 미리 요청.
 * Android Chrome은 오버레이(fixed/absolute)가 있을 때 권한 다이얼로그를 차단하므로,
 * 오버레이가 없는 초기 상태에서 미리 권한을 받아두면 이후 요청 시 다이얼로그 없이 동작함.
 */
async function preRequestLocationPermission() {
  try {
    // Permissions API로 이미 허용 여부 확인
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "granted") {
        console.log("[LocationResponder] 📍 Location permission already granted");
        return;
      }
    }

    // 아직 허용되지 않은 경우, 짧은 타임아웃으로 위치 요청하여 권한 다이얼로그 트리거
    console.log("[LocationResponder] 📍 Pre-requesting location permission...");
    await getPosition(true, 5000);
    console.log("[LocationResponder] ✅ Location permission granted via pre-request");
  } catch (err) {
    // 사용자가 거부하거나 타임아웃되어도 무시 — 나중에 다시 시도됨
    console.warn("[LocationResponder] Pre-request failed (user may have denied):", err);
  }
}
