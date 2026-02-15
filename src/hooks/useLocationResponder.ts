import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { Json } from "@/integrations/supabase/types";

/**
 * 스마트폰의 위치 응답 훅
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
            const position = await getCurrentPosition();
            const { latitude, longitude } = position.coords;

            console.log("[LocationResponder] GPS acquired:", { latitude, longitude });

            // 기존 metadata를 보존하면서 locate_requested를 null로 초기화
            const existingMeta = metadata as Record<string, unknown>;
            const updatedMeta: Record<string, unknown> = {
              ...existingMeta,
              locate_requested: null,
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
              console.log("[LocationResponder] ✅ Location updated successfully");
            }
          } catch (err) {
            console.error("[LocationResponder] GPS acquisition failed:", err);

            // GPS 실패 시에도 locate_requested를 null로 초기화 (무한 재시도 방지)
            const existingMeta = (metadata as Record<string, unknown>) || {};
            await supabase
              .from("devices")
              .update({
                metadata: {
                  ...existingMeta,
                  locate_requested: null,
                  locate_error: "GPS acquisition failed",
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

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}
