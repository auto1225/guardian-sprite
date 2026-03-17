import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithRetry } from "@/lib/invokeWithRetry";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

import { LAPTOP_DB_URL, LAPTOP_DB_ANON_KEY } from "@/lib/laptopDb";

/**
 * 스마트폰 앱 최초 실행 시 devices 테이블에 자신을 자동 등록하는 훅
 * - 공유 DB (이 프로젝트) + 랩탑 로컬 DB 양쪽에 등록
 */
export function useSmartphoneRegistration() {
  const { effectiveUserId } = useAuth();
  const queryClient = useQueryClient();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!effectiveUserId || registeredRef.current) return;

    const registerSmartphone = async () => {
      try {
        // 1) 공유 DB (이 프로젝트)에 등록
        let deviceId: string | undefined;
        try {
          const { data, error } = await supabase.functions.invoke("register-device", {
            body: {
              user_id: effectiveUserId,
              device_name: "My Smartphone",
              device_type: "smartphone",
            },
          });

          if (error) {
            console.error("[SmartphoneReg] Shared DB register error:", error);
          } else {
            deviceId = data?.device_id;
            const reconnected = data?.reconnected;
            if (reconnected) {
              console.log("[SmartphoneReg] Already registered:", deviceId?.slice(0, 8));
            } else {
              console.log("[SmartphoneReg] ✅ Smartphone registered:", deviceId?.slice(0, 8));
            }
          }
        } catch (sharedErr) {
          console.error("[SmartphoneReg] Shared DB error:", sharedErr);
        }

        // 2) 랩탑 로컬 DB에도 등록 (독립 실행, fire-and-forget)
        // 랩탑 DB는 device_id(unique) = user_id 패턴 사용, smartphone은 별도 ID 필요
        const smartphoneDeviceId = `${effectiveUserId}-smartphone`;
        fetch(`${LAPTOP_DB_URL}/functions/v1/register-device`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: LAPTOP_DB_ANON_KEY },
          body: JSON.stringify({
            user_id: effectiveUserId,
            device_name: "My Smartphone",
            device_type: "smartphone",
            device_id_override: smartphoneDeviceId,
          }),
        })
          .then(res => res.ok
            ? res.json().then(d => console.log("[SmartphoneReg] ✅ Laptop DB register OK:", d.device?.id?.slice(0, 8)))
            : res.text().then(t => console.warn("[SmartphoneReg] ⚠️ Laptop DB register failed:", t)))
          .catch(err => console.warn("[SmartphoneReg] ⚠️ Laptop DB register error:", err));

        // 앱 시작 시 스마트폰 상태만 online으로 설정 (감시 상태는 유지)
        if (deviceId) {
          await invokeWithRetry("update-device", {
            body: { device_id: deviceId, updates: { status: "online" }, _skip_push: true },
          });
        }

        console.log("[SmartphoneReg] ✅ Smartphone online, monitoring state preserved");
        registeredRef.current = true;
        queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
      } catch (err) {
        console.error("[SmartphoneReg] Unexpected error:", err);
      }
    };

    registerSmartphone();
  }, [effectiveUserId, queryClient]);
}
