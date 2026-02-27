import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

/**
 * 스마트폰 앱 최초 실행 시 devices 테이블에 자신을 자동 등록하는 훅
 * - device_type === 'smartphone' 레코드가 없으면 자동 생성
 * - 이미 존재하면 스킵
 */
export function useSmartphoneRegistration() {
  const { effectiveUserId } = useAuth();
  const queryClient = useQueryClient();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!effectiveUserId || registeredRef.current) return;

    const registerSmartphone = async () => {
      try {
        // Edge Function을 통해 스마트폰 등록 (RLS 우회)
        const { data, error } = await supabase.functions.invoke("register-device", {
          body: {
            user_id: effectiveUserId,
            device_name: "My Smartphone",
            device_type: "smartphone",
          },
        });

        if (error) {
          console.error("[SmartphoneReg] Register error:", error);
          return;
        }

        const deviceId = data?.device_id;
        const reconnected = data?.reconnected;

        if (reconnected) {
          console.log("[SmartphoneReg] Already registered:", deviceId?.slice(0, 8));
        } else {
          console.log("[SmartphoneReg] ✅ Smartphone registered:", deviceId?.slice(0, 8));
        }

        // 앱 시작 시 감시 OFF 리셋 (Edge Function으로)
        if (deviceId) {
          await supabase.functions.invoke("update-device", {
            body: { device_id: deviceId, is_monitoring: false, status: "online" },
          });
        }

        // 사용자의 모든 노트북/데스크탑 기기도 감시 OFF로 리셋
        const { data: devicesData } = await supabase.functions.invoke("get-devices", {
          body: { user_id: effectiveUserId },
        });
        const allDevices = devicesData?.devices || [];
        const laptopDevices = allDevices.filter(
          (d: any) => d.device_type !== "smartphone" && d.is_monitoring
        );

        for (const laptop of laptopDevices) {
          await supabase.functions.invoke("update-device", {
            body: { device_id: laptop.id, is_monitoring: false },
          });

          // Broadcast monitoring OFF to each laptop
          const broadcastChannelName = `device-commands-${laptop.id}`;
          const existingCh = supabase.getChannels().find(ch => ch.topic === `realtime:${broadcastChannelName}`);
          if (existingCh) supabase.removeChannel(existingCh);
          
          const channel = supabase.channel(broadcastChannelName);
          try {
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => { supabase.removeChannel(channel); resolve(); }, 3000);
              channel.subscribe((status) => {
                if (status === "SUBSCRIBED") {
                  clearTimeout(timeout);
                  channel.send({
                    type: "broadcast",
                    event: "monitoring_toggle",
                    payload: { device_id: laptop.id, is_monitoring: false },
                  }).then(() => { supabase.removeChannel(channel); resolve(); });
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                  clearTimeout(timeout);
                  supabase.removeChannel(channel);
                  resolve();
                }
              });
            });
          } catch { /* best-effort */ }
        }

        console.log("[SmartphoneReg] ♻️ Reset ALL devices monitoring to OFF on app start");
        registeredRef.current = true;
        queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });

        return;
      } catch (err) {
        console.error("[SmartphoneReg] Unexpected error:", err);
      }
    };

    registerSmartphone();
  }, [effectiveUserId, queryClient]);
}
