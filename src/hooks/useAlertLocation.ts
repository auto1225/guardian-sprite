import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AlertLocation {
  latitude: number;
  longitude: number;
  locationSource: "gps" | "wifi" | "db" | string;
}

/**
 * 경보 발생 시 위치 정보를 신뢰성 있게 획득하는 훅
 * 1) device 객체의 latitude/longitude를 먼저 사용
 * 2) 없으면 get-devices 폴링으로 DB에서 최신 위치 확인 (5초 간격, 최대 6회)
 * 3) 그래도 없으면 device_locations 테이블에서 최근 기록 조회
 */
export function useAlertLocation(
  deviceId: string | undefined,
  deviceLat: number | null | undefined,
  deviceLng: number | null | undefined,
  isActive: boolean
): AlertLocation | null {
  const [location, setLocation] = useState<AlertLocation | null>(() => {
    if (deviceLat != null && deviceLng != null) {
      return { latitude: deviceLat, longitude: deviceLng, locationSource: "device" };
    }
    return null;
  });

  const pollCountRef = useRef(0);
  const MAX_POLLS = 6;
  const resolvedRef = useRef(false);

  // 즉시 device 값이 있으면 반영
  useEffect(() => {
    if (deviceLat != null && deviceLng != null) {
      resolvedRef.current = true;
      setLocation({ latitude: deviceLat, longitude: deviceLng, locationSource: "device" });
    }
  }, [deviceLat, deviceLng]);

  // 위치 없을 때 폴링 + DB fallback
  useEffect(() => {
    if (!isActive || !deviceId || resolvedRef.current) return;

    pollCountRef.current = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || resolvedRef.current) return;
      pollCountRef.current++;

      try {
        // 1) get-devices로 최신 위치 확인
        const { data, error } = await supabase.functions.invoke("get-devices", {
          body: { device_id: deviceId },
        });
        if (!error && data) {
          const devices = data.devices || data || [];
          const dev = Array.isArray(devices)
            ? devices.find((d: any) => d.id === deviceId)
            : null;
          if (dev?.latitude != null && dev?.longitude != null) {
            const meta = dev.metadata as Record<string, unknown> | null;
            const source = (meta?.location_source as string) || "db";
            resolvedRef.current = true;
            if (!cancelled) {
              setLocation({ latitude: dev.latitude, longitude: dev.longitude, locationSource: source });
            }
            return;
          }
        }
      } catch {
        // non-critical
      }

      // 폴링 한도 도달 시 device_locations fallback
      if (pollCountRef.current >= MAX_POLLS && !resolvedRef.current) {
        try {
          const { data: locData } = await supabase
            .from("device_locations")
            .select("latitude, longitude")
            .eq("device_id", deviceId)
            .not("latitude", "is", null)
            .not("longitude", "is", null)
            .order("recorded_at", { ascending: false })
            .limit(1)
            .single();

          if (locData?.latitude != null && locData?.longitude != null) {
            resolvedRef.current = true;
            if (!cancelled) {
              setLocation({
                latitude: locData.latitude,
                longitude: locData.longitude,
                locationSource: "history",
              });
            }
            return;
          }
        } catch {
          // no history
        }
      }
    };

    // 즉시 1회 + 5초 간격 폴링
    poll();
    const interval = setInterval(() => {
      if (resolvedRef.current || pollCountRef.current >= MAX_POLLS) {
        clearInterval(interval);
        return;
      }
      poll();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, deviceId]);

  // alert 비활성화 시 리셋
  useEffect(() => {
    if (!isActive) {
      resolvedRef.current = false;
      pollCountRef.current = 0;
    }
  }, [isActive]);

  return location;
}
