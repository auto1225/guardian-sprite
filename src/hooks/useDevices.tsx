import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

export const useDevices = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading, error } = useQuery({
    queryKey: ["devices", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data as Device[];
    },
    enabled: !!user,
  });

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Auto-select first device when devices load
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;

  const addDevice = useMutation({
    mutationFn: async (device: Omit<DeviceInsert, "user_id">) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("devices")
        .insert({ ...device, user_id: user.id })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", user?.id] });
    },
  });

  const updateDevice = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Device>) => {
      const { data, error } = await supabase
        .from("devices")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", user?.id] });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("devices")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", user?.id] });
    },
  });

  // Subscribe to realtime updates - DB Realtime + Presence 기반 상태 수신 (폴링 없음)
  useEffect(() => {
    if (!user) return;

    let dbChannel: ReturnType<typeof supabase.channel> | null = null;
    const presenceChannels: Map<string, ReturnType<typeof supabase.channel>> = new Map();
    let retryCount = 0;
    let retryTimeout: NodeJS.Timeout | null = null;
    const maxRetries = 5;

    const setupDbChannel = () => {
      // 기존 채널 정리
      if (dbChannel) {
        supabase.removeChannel(dbChannel);
      }

      dbChannel = supabase
        .channel(`devices-realtime-${Date.now()}`) // 고유한 채널명
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "devices",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const updatedDevice = payload.new as Device;
            console.log("[Realtime] Device updated:", updatedDevice.id, {
              is_camera_connected: updatedDevice.is_camera_connected,
              is_network_connected: updatedDevice.is_network_connected,
              status: updatedDevice.status,
            });
            queryClient.setQueryData(
              ["devices", user.id],
              (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.map((device) =>
                  device.id === updatedDevice.id
                    ? { ...device, ...updatedDevice }
                    : device
                );
              }
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "devices",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log("[Realtime] Device inserted:", payload.new);
            queryClient.setQueryData(
              ["devices", user.id],
              (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return [payload.new as Device];
                return [...oldDevices, payload.new as Device];
              }
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "devices",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log("[Realtime] Device deleted:", payload.old);
            queryClient.setQueryData(
              ["devices", user.id],
              (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.filter(
                  (device) => device.id !== (payload.old as Device).id
                );
              }
            );
          }
        )
        .subscribe((status) => {
          console.log("[Realtime] Devices DB channel status:", status);
          
          if (status === "SUBSCRIBED") {
            retryCount = 0; // 성공 시 재시도 카운트 리셋
          } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
            // 재연결 시도
            if (retryCount < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
              console.log(`[Realtime] Reconnecting in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
              retryTimeout = setTimeout(() => {
                retryCount++;
                setupDbChannel();
              }, delay);
            } else {
              console.error("[Realtime] Max retries reached, falling back to polling");
              // Fallback: 폴링으로 데이터 갱신
              queryClient.invalidateQueries({ queryKey: ["devices", user.id] });
            }
          }
        });
    };

    // Presence 채널 설정 (각 디바이스별 상태 수신)
    const setupPresenceChannels = (deviceList: Device[]) => {
      // 기존 채널 정리
      presenceChannels.forEach((ch) => supabase.removeChannel(ch));
      presenceChannels.clear();

      deviceList.forEach((device) => {
        const presenceChannel = supabase.channel(`device-presence-${device.id}`);
        
        presenceChannel
          .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            const laptopPresence = state[device.id]?.[0] as {
              status?: string;
              is_network_connected?: boolean;
              is_camera_connected?: boolean;
            } | undefined;
            
            if (laptopPresence) {
              console.log("[Presence] Device status received:", device.id, laptopPresence);
              
              // 로컬 캐시 업데이트 (DB 쿼리 없이)
              queryClient.setQueryData(
                ["devices", user.id],
                (oldDevices: Device[] | undefined) => {
                  if (!oldDevices) return oldDevices;
                  return oldDevices.map((d) =>
                    d.id === device.id
                      ? {
                          ...d,
                          status: laptopPresence.status === 'online' ? 'online' : 'offline',
                          is_network_connected: laptopPresence.is_network_connected ?? d.is_network_connected,
                          is_camera_connected: laptopPresence.is_camera_connected ?? d.is_camera_connected,
                        }
                      : d
                  ) as Device[];
                }
              );
            }
          })
          .subscribe((status) => {
            console.log(`[Presence] Device ${device.id} channel status:`, status);
          });

        presenceChannels.set(device.id, presenceChannel);
      });
    };

    setupDbChannel();

    // 디바이스 목록이 변경되면 Presence 채널 재설정
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "devices" && event.query.queryKey[1] === user.id) {
        const deviceList = event.query.state.data as Device[] | undefined;
        if (deviceList && deviceList.length > 0) {
          setupPresenceChannels(deviceList);
        }
      }
    });

    return () => {
      unsubscribe();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (dbChannel) {
        supabase.removeChannel(dbChannel);
      }
      presenceChannels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [user, queryClient]);

  return {
    devices,
    isLoading,
    error,
    selectedDevice,
    selectedDeviceId,
    setSelectedDeviceId,
    addDevice,
    updateDevice,
    deleteDevice,
  };
};
