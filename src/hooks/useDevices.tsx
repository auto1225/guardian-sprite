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

  // Subscribe to realtime updates - DB Realtime + Presence 기반 상태 수신 (싱글톤 채널)
  useEffect(() => {
    if (!user) return;

    let dbChannel: ReturnType<typeof supabase.channel> | null = null;
    const presenceChannels: Map<string, ReturnType<typeof supabase.channel>> = new Map();
    let isChannelActive = true;

    // 싱글톤 DB 채널 - 고정된 이름 사용 (Date.now() 제거)
    const channelName = `devices-db-${user.id}`;
    
    const setupDbChannel = () => {
      if (!isChannelActive) return;
      
      // 이미 같은 이름의 채널이 있으면 재사용
      const existingChannel = supabase.getChannels().find(ch => ch.topic === `realtime:${channelName}`);
      if (existingChannel) {
        console.log("[Realtime] Reusing existing DB channel");
        dbChannel = existingChannel as ReturnType<typeof supabase.channel>;
        return;
      }
      
      dbChannel = supabase
        .channel(channelName, {
          config: {
            broadcast: { self: false },
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
            // 카메라 상태 변경 시 명시적 로깅
            console.log("[Realtime] Device updated:", {
              id: updatedDevice.id,
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
                    ? { 
                        ...device, 
                        ...updatedDevice,
                        // 카메라 상태는 명시적으로 업데이트 (undefined 방지)
                        is_camera_connected: updatedDevice.is_camera_connected ?? device.is_camera_connected,
                      }
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
            console.log("[Realtime] Device inserted");
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
            console.log("[Realtime] Device deleted");
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
          // 최소 로깅 - 에러만 표시
          if (status === "CHANNEL_ERROR") {
            console.error("[Realtime] DB channel error");
          }
        });
    };

    // 이미 설정된 디바이스 ID 추적
    const setupDeviceIds = new Set<string>();
    // leave 이벤트 디바운스 타이머
    const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // Presence 채널 설정 (각 디바이스별 상태 수신)
    const setupPresenceChannel = (device: Device) => {
      if (!isChannelActive) return;
      if (setupDeviceIds.has(device.id)) return; // 이미 설정된 디바이스는 스킵
      
      setupDeviceIds.add(device.id);
      
      // 노트북 앱과 동일한 설정 사용
      const presenceChannel = supabase.channel(`device-presence-${device.id}`, {
        config: {
          presence: { key: device.id },
        },
      });
      
      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel.presenceState();
          
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
            
            // 카메라 상태 변경 시만 로그 출력
            console.log("[Presence] Sync:", device.id, {
              camera: laptopPresence.is_camera_connected,
              network: laptopPresence.is_network_connected,
              status: laptopPresence.status,
            });
            
            // 함수형 업데이트로 최신 상태 기반 업데이트 (stale closure 방지)
            queryClient.setQueryData(
              ["devices", user.id],
              (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.map((d) => {
                  if (d.id !== device.id) return d;
                  
                  // Presence에서는 status와 network만 업데이트
                  // ⚠️ is_camera_connected는 DB Realtime에서만 업데이트 (Presence가 덮어쓰는 문제 방지)
                  const newNetworkConnected = laptopPresence.is_network_connected;
                  const newStatus = laptopPresence.status === 'online' ? 'online' : 'offline';
                  
                  // 실제 변경이 있는지 확인 (camera 제외)
                  const hasChanges = 
                    d.is_network_connected !== newNetworkConnected ||
                    d.status !== newStatus;
                  
                  if (!hasChanges) return d;
                  
                  console.log("[Presence] ✅ Updating device state (status/network only):", {
                    id: device.id.slice(0, 8),
                    network: `${d.is_network_connected} → ${newNetworkConnected}`,
                    status: `${d.status} → ${newStatus}`,
                  });
                  
                  return {
                    ...d,
                    status: newStatus as Device["status"],
                    is_network_connected: newNetworkConnected ?? d.is_network_connected,
                    // is_camera_connected는 DB Realtime에서만 관리 - 여기서 업데이트 안 함!
                  };
                });
              }
            );
          } else {
            console.log("[Presence] No presence data for device:", device.id);
          }
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log("[Presence] 👋 Device joined:", key, newPresences);
          // join 시 기존 leave 타이머 취소 (재연결된 것이므로)
          if (key === device.id) {
            const existingTimer = leaveTimers.get(device.id);
            if (existingTimer) {
              clearTimeout(existingTimer);
              leaveTimers.delete(device.id);
              console.log("[Presence] ⏱️ Leave timer cancelled (device rejoined):", device.id.slice(0, 8));
            }
          }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log("[Presence] 👋 Device left:", key, leftPresences);
          // 디바운스: 3초 후에도 재접속하지 않으면 오프라인 처리
          if (key === device.id) {
            // 기존 타이머 취소
            const existingTimer = leaveTimers.get(device.id);
            if (existingTimer) clearTimeout(existingTimer);

            const timer = setTimeout(() => {
              leaveTimers.delete(device.id);
              console.log("[Presence] ⏱️ Leave confirmed (no rejoin):", device.id.slice(0, 8));
              // DB에서 최신 카메라 상태를 가져온 후 오프라인 처리
              supabase
                .from("devices")
                .select("is_camera_connected")
                .eq("id", device.id)
                .maybeSingle()
                .then(({ data }) => {
                  queryClient.setQueryData(
                    ["devices", user.id],
                    (oldDevices: Device[] | undefined) => {
                      if (!oldDevices) return oldDevices;
                      return oldDevices.map((d) =>
                        d.id === device.id
                          ? { ...d, status: 'offline' as const, is_camera_connected: data?.is_camera_connected ?? d.is_camera_connected }
                          : d
                      );
                    }
                  );
                });
            }, 3000);
            leaveTimers.set(device.id, timer);
          }
        })
        .subscribe((status) => {
          // 최소 로깅 - 에러만 표시
          if (status === "CHANNEL_ERROR") {
            console.error(`[Presence] Device ${device.id} channel error`);
          }
        });

      presenceChannels.set(device.id, presenceChannel);
    };

    // 초기 디바이스 목록으로 Presence 채널 설정
    const setupAllPresenceChannels = (deviceList: Device[]) => {
      deviceList.forEach((device) => {
        setupPresenceChannel(device);
      });
    };

    setupDbChannel();

    // 초기 디바이스 로드 후 Presence 채널 설정 (한 번만)
    const currentDevices = queryClient.getQueryData<Device[]>(["devices", user.id]);
    if (currentDevices && currentDevices.length > 0) {
      setupAllPresenceChannels(currentDevices);
    }

    // 새 디바이스가 추가될 때만 Presence 채널 설정
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "devices" && event.query.queryKey[1] === user.id) {
        const deviceList = event.query.state.data as Device[] | undefined;
        if (deviceList && deviceList.length > 0) {
          // 새 디바이스만 추가 (기존 것은 스킵됨)
          deviceList.forEach((device) => {
            if (!setupDeviceIds.has(device.id)) {
              setupPresenceChannel(device);
            }
          });
        }
      }
    });

    return () => {
      isChannelActive = false;
      unsubscribe();
      // leave 디바운스 타이머 정리
      leaveTimers.forEach((timer) => clearTimeout(timer));
      leaveTimers.clear();
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
