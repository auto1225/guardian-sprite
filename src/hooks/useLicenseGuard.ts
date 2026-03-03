import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30분마다 체크

/**
 * 라이선스 만료를 실시간 감지하여 기능을 차단하는 훅
 * - serials의 expires_at를 주기적으로 확인
 * - 모든 시리얼이 만료되면 expired = true
 * - 만료 시 모니터링 자동 중지
 */
export function useLicenseGuard() {
  const { serials, serialsLoading, effectiveUserId, refreshSerials } = useAuth();
  const [expired, setExpired] = useState(false);
  const [expiryChecked, setExpiryChecked] = useState(false);
  const queryClient = useQueryClient();
  const stopMonitoringRef = useRef(false);

  const checkExpiry = useCallback(() => {
    if (serialsLoading || serials.length === 0) {
      // 시리얼이 아직 로딩 중이거나 없으면 체크하지 않음
      return;
    }

    const now = new Date();
    const allExpired = serials.every((s) => {
      if (!s.expires_at) return false; // 무기한은 만료되지 않음
      return new Date(s.expires_at) < now;
    });

    setExpired(allExpired);
    setExpiryChecked(true);

    // 만료 시 모니터링 자동 중지
    if (allExpired && !stopMonitoringRef.current && effectiveUserId) {
      stopMonitoringRef.current = true;
      stopAllMonitoring(effectiveUserId);
    }
  }, [serials, serialsLoading, effectiveUserId]);

  // 모니터링 중인 기기 모두 중지
  const stopAllMonitoring = async (userId: string) => {
    try {
      const { data: devices } = await supabase.functions.invoke("get-devices", {
        body: { user_id: userId },
      });
      const monitoringDevices = (devices?.devices || []).filter(
        (d: { is_monitoring: boolean }) => d.is_monitoring
      );

      for (const dev of monitoringDevices) {
        await supabase.functions.invoke("update-device", {
          body: {
            device_id: dev.id,
            updates: { is_monitoring: false },
          },
        });
      }

      if (monitoringDevices.length > 0) {
        console.log(`[LicenseGuard] ⛔ Stopped monitoring on ${monitoringDevices.length} device(s) due to expiry`);
        queryClient.invalidateQueries({ queryKey: ["devices"] });
      }
    } catch (err) {
      console.warn("[LicenseGuard] Failed to stop monitoring:", err);
    }
  };

  // 초기 체크 + 주기적 체크
  useEffect(() => {
    checkExpiry();

    const interval = setInterval(() => {
      // 주기적으로 시리얼 새로고침 후 체크
      refreshSerials().then(() => checkExpiry());
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkExpiry, refreshSerials]);

  // serials 변경 시 재체크
  useEffect(() => {
    checkExpiry();
  }, [serials, checkExpiry]);

  // 만료 해제 시 차단 리셋
  useEffect(() => {
    if (!expired) {
      stopMonitoringRef.current = false;
    }
  }, [expired]);

  return { expired, expiryChecked };
}
