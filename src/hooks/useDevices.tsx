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

  // 디바이스 상태 새로고침 함수 (외부에서 호출 가능)
  const refreshDeviceStatus = async (deviceId?: string) => {
    if (!user) return;
    
    try {
      const query = supabase
        .from("devices")
        .select("*")
        .eq("user_id", user.id);
      
      if (deviceId) {
        query.eq("id", deviceId);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error("[Devices] Refresh error:", error);
        return;
      }
      
      if (data && data.length > 0) {
        console.log("[Devices] Refreshed from DB:", data.map(d => ({
          id: d.id,
          is_camera_connected: d.is_camera_connected,
          is_network_connected: d.is_network_connected,
          status: d.status,
        })));
        
        queryClient.setQueryData(
          ["devices", user.id],
          (oldDevices: Device[] | undefined) => {
            if (!oldDevices) return data;
            return oldDevices.map((device) => {
              const updated = data.find((d) => d.id === device.id);
              return updated ? { ...device, ...updated } : device;
            });
          }
        );
      }
    } catch (err) {
      console.error("[Devices] Refresh failed:", err);
    }
  };

  // Subscribe to realtime updates - DB Realtime + Presence 기반 상태 수신 (폴링 없음)
  useEffect(() => {
    if (!user) return;

    let dbChannel: ReturnType<typeof supabase.channel> | null = null;
    const presenceChannels: Map<string, ReturnType<typeof supabase.channel>> = new Map();
    let retryCount = 0;
    let retryTimeout: NodeJS.Timeout | null = null;
    const maxRetries = 5;
    let isChannelActive = true; // 채널 활성 상태 추적

    const setupDbChannel = () => {
      if (!isChannelActive) return; // 컴포넌트 언마운트 시 중단
      
      // 기존 채널 정리
      if (dbChannel) {
        supabase.removeChannel(dbChannel);
      }

      // 고유한 채널명 + params 설정
      const channelName = `devices-db-${user.id}-${Date.now()}`;
      
      dbChannel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
            presence: { key: user.id },
          },
        })
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
            // 구독 성공 시 최신 데이터 한 번 fetch
            refreshDeviceStatus();
          } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
            if (!isChannelActive) return; // 언마운트 시 재연결 안 함
            
            // 재연결 시도
            if (retryCount < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
              console.log(`[Realtime] Reconnecting in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
              retryTimeout = setTimeout(() => {
                retryCount++;
                setupDbChannel();
              }, delay);
            } else {
              console.error("[Realtime] Max retries reached, doing one-time refresh");
              // Fallback: 한 번만 데이터 갱신
              refreshDeviceStatus();
            }
          }
        });
    };

    // Presence 채널 설정 (각 디바이스별 상태 수신)
    const setupPresenceChannels = (deviceList: Device[]) => {
      if (!isChannelActive) return;
      
      // 기존 채널 정리
      presenceChannels.forEach((ch) => supabase.removeChannel(ch));
      presenceChannels.clear();

      deviceList.forEach((device) => {
        // 노트북 앱과 동일한 설정 사용
        const presenceChannel = supabase.channel(`device-presence-${device.id}`, {
          config: {
            presence: { key: device.id },
          },
        });
        
        presenceChannel
          .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            console.log("[Presence] Full state for device", device.id, ":", state);
            
            const presenceList = state[device.id] as Array<{
              status?: string;
              is_network_connected?: boolean;
              is_camera_connected?: boolean;
              last_seen_at?: string;
              presence_ref?: string;
            }> | undefined;
            
            if (presenceList && presenceList.length > 0) {
              // 가장 최신 Presence 항목 선택 (last_seen_at 기준)
              const laptopPresence = presenceList.reduce((latest, current) => {
                const latestTime = latest.last_seen_at ? new Date(latest.last_seen_at).getTime() : 0;
                const currentTime = current.last_seen_at ? new Date(current.last_seen_at).getTime() : 0;
                return currentTime > latestTime ? current : latest;
              });
              
              console.log("[Presence] ✅ Using latest presence:", device.id, laptopPresence);
              
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
            } else {
              console.log("[Presence] No presence data for device:", device.id, "keys:", Object.keys(state));
            }
          })
          .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log("[Presence] 👋 Device joined:", key, newPresences);
          })
          .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            console.log("[Presence] 👋 Device left:", key, leftPresences);
            // 노트북이 떠나면 오프라인으로 표시
            if (key === device.id) {
              queryClient.setQueryData(
                ["devices", user.id],
                (oldDevices: Device[] | undefined) => {
                  if (!oldDevices) return oldDevices;
                  return oldDevices.map((d) =>
                    d.id === device.id
                      ? { ...d, status: 'offline' as const, is_camera_connected: false }
                      : d
                  );
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
      isChannelActive = false; // 언마운트 표시
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
    refreshDeviceStatus, // 외부에서 수동 새로고침 가능
  };
};
