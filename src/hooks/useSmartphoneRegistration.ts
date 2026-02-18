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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!user || registeredRef.current) return;

    const registerSmartphone = async () => {
      try {
        // 이미 등록된 스마트폰이 있는지 확인
        const { data: existing, error: fetchError } = await supabase
          .from("devices")
          .select("id")
          .eq("user_id", user.id)
          .eq("device_type", "smartphone")
          .limit(1);

        if (fetchError) {
          console.error("[SmartphoneReg] Fetch error:", fetchError);
          return;
        }

        if (existing && existing.length > 0) {
          console.log("[SmartphoneReg] Already registered:", existing[0].id.slice(0, 8));
          // 앱 시작 시 항상 감시 OFF 상태로 리셋 (터치 인터랙션 확보를 위해)
          // 스마트폰 자신 리셋
          await supabase
            .from("devices")
            .update({ is_monitoring: false, status: "online", last_seen_at: new Date().toISOString() })
            .eq("id", existing[0].id);

          // 사용자의 모든 노트북/데스크탑 기기도 감시 OFF로 리셋
          const { data: laptopDevices } = await supabase
            .from("devices")
            .select("id")
            .eq("user_id", user.id)
            .neq("device_type", "smartphone")
            .eq("is_monitoring", true);

          if (laptopDevices && laptopDevices.length > 0) {
            await supabase
              .from("devices")
              .update({ is_monitoring: false })
              .eq("user_id", user.id)
              .neq("device_type", "smartphone");

            // Broadcast monitoring OFF to each laptop
            for (const laptop of laptopDevices) {
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
          }

          console.log("[SmartphoneReg] ♻️ Reset ALL devices monitoring to OFF on app start");
          registeredRef.current = true;
          queryClient.invalidateQueries({ queryKey: ["devices", user.id] });
          return;
        }

        // 스마트폰 디바이스 등록
        const { data, error } = await supabase
          .from("devices")
          .insert({
            user_id: user.id,
            name: "My Smartphone",
            device_type: "smartphone",
            status: "online",
            is_monitoring: false,
            is_camera_connected: false,
            is_network_connected: true,
            last_seen_at: new Date().toISOString(),
            metadata: {},
          })
          .select()
          .single();

        if (error) {
          console.error("[SmartphoneReg] Insert error:", error);
          return;
        }

        console.log("[SmartphoneReg] ✅ Smartphone registered:", data.id.slice(0, 8));
        registeredRef.current = true;

        // 디바이스 목록 갱신
        queryClient.invalidateQueries({ queryKey: ["devices", user.id] });
      } catch (err) {
        console.error("[SmartphoneReg] Unexpected error:", err);
      }
    };

    registerSmartphone();
  }, [user?.id, queryClient]);
}
