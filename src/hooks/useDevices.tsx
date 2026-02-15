import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

// 모듈 레벨 싱글톤: Presence/DB 채널 중복 생성 방지
let activeUserId: string | null = null;
let activeDbChannel: ReturnType<typeof supabase.channel> | null = null;
const activePresenceChannels = new Map<string, ReturnType<typeof supabase.channel>>();
const activeDeviceIds = new Set<string>();
const activeLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Realtime으로 온라인 확인된 디바이스 추적 (stale 보정 방지)
const realtimeConfirmedOnline = new Set<string>();
let subscriberCount = 0;

function cleanupAllChannels() {
  activeLeaveTimers.forEach((timer) => clearTimeout(timer));
  activeLeaveTimers.clear();
  if (activeDbChannel) {
    supabase.removeChannel(activeDbChannel);
    activeDbChannel = null;
  }
  activePresenceChannels.forEach((ch) => supabase.removeChannel(ch));
  activePresenceChannels.clear();
  activeDeviceIds.clear();
  realtimeConfirmedOnline.clear();
  activeUserId = null;
  subscriberCount = 0;
}

function setupPresenceChannelSingleton(
  device: Device,
  userId: string,
  queryClient: ReturnType<typeof import("@tanstack/react-query").useQueryClient>
) {
  if (activeDeviceIds.has(device.id)) return;
  activeDeviceIds.add(device.id);

  const presenceChannel = supabase.channel(`device-presence-${device.id}`, {
    config: { presence: { key: device.id } },
  });

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      const presenceList = state[device.id] as Array<{
        status?: string;
        is_network_connected?: boolean;
        is_camera_connected?: boolean;
        last_seen_at?: string;
      }> | undefined;

      if (presenceList && presenceList.length > 0) {
        const laptopPresence = presenceList.reduce((latest, current) => {
          const latestTime = latest.last_seen_at ? new Date(latest.last_seen_at).getTime() : 0;
          const currentTime = current.last_seen_at ? new Date(current.last_seen_at).getTime() : 0;
          return currentTime > latestTime ? current : latest;
        });

        queryClient.setQueryData(["devices", userId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) => {
            if (d.id !== device.id) return d;
            const newNetworkConnected = laptopPresence.is_network_connected;
            const newStatus = laptopPresence.status === 'online' ? 'online' : 'offline';
            if (newStatus === 'online') {
              realtimeConfirmedOnline.add(device.id);
            } else {
              realtimeConfirmedOnline.delete(device.id);
            }
            const hasChanges = d.is_network_connected !== newNetworkConnected || d.status !== newStatus;
            if (!hasChanges) return d;
            console.log("[Presence] ✅ Updating:", device.id.slice(0, 8), { status: `${d.status}→${newStatus}` });
            return {
              ...d,
              status: newStatus as Device["status"],
              is_network_connected: newNetworkConnected ?? d.is_network_connected,
            };
          });
        });
      }
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      if (key === device.id) {
        const existingTimer = activeLeaveTimers.get(device.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
          activeLeaveTimers.delete(device.id);
        }
      }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key === device.id) {
        const existingTimer = activeLeaveTimers.get(device.id);
        if (existingTimer) clearTimeout(existingTimer);

        // 즉시 오프라인으로 UI 반영
        realtimeConfirmedOnline.delete(device.id);
        queryClient.setQueryData(["devices", userId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) =>
            d.id === device.id
              ? { ...d, status: 'offline' as Device["status"], is_network_connected: false }
              : d
          );
        });

        // 3초 후 DB에서 실제 상태 재확인 (일시적 단절 보정)
        const timer = setTimeout(() => {
          activeLeaveTimers.delete(device.id);
          supabase
            .from("devices")
            .select("status, is_camera_connected, is_network_connected")
            .eq("id", device.id)
            .maybeSingle()
            .then(({ data }) => {
              queryClient.setQueryData(["devices", userId], (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.map((d) =>
                  d.id === device.id
                    ? {
                        ...d,
                        status: (data?.status ?? 'offline') as Device["status"],
                        is_network_connected: data?.is_network_connected ?? false,
                        is_camera_connected: data?.is_camera_connected ?? d.is_camera_connected,
                      }
                    : d
                );
              });
            });
        }, 3000);
        activeLeaveTimers.set(device.id, timer);
      }
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") console.error(`[Presence] Channel error: ${device.id.slice(0, 8)}`);
    });

  activePresenceChannels.set(device.id, presenceChannel);
}

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
      
      // last_seen_at이 2분 이상 지난 디바이스는 offline으로 보정
      const STALE_THRESHOLD_MS = 2 * 60 * 1000;
      const now = Date.now();
      const corrected = (data as Device[]).map((d) => {
        if (d.device_type === "smartphone") return d; // 스마트폰은 자기 자신이므로 스킵
        // Realtime으로 온라인 확인된 디바이스는 stale 보정 건너뛰기
        if (realtimeConfirmedOnline.has(d.id)) return d;
        const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
        if (now - lastSeen > STALE_THRESHOLD_MS && d.status !== "offline") {
          console.log("[Devices] Stale device corrected to offline:", d.id.slice(0, 8), { lastSeen: d.last_seen_at });
          return { ...d, status: "offline" as Device["status"], is_network_connected: false };
        }
        return d;
      });
      return corrected;
    },
    enabled: !!user,
  });

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Auto-select first non-smartphone device when devices load
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      const nonSmartphone = devices.find(d => d.device_type !== "smartphone");
      setSelectedDeviceId(nonSmartphone?.id ?? devices[0].id);
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

  // Subscribe to realtime updates - 모듈 레벨 싱글톤 채널 사용
  useEffect(() => {
    if (!user) return;

    // 구독자 카운트 증가
    subscriberCount++;

    // 이미 같은 유저로 채널이 설정되어 있으면 스킵
    if (activeUserId === user.id) {
      // 새 디바이스가 추가될 때만 Presence 채널 설정
      const currentDevices = queryClient.getQueryData<Device[]>(["devices", user.id]);
      if (currentDevices) {
        currentDevices.forEach((device) => {
          if (!activeDeviceIds.has(device.id)) {
            setupPresenceChannelSingleton(device, user.id, queryClient);
          }
        });
      }
      
      // 캐시 구독 (새 디바이스 추가 감지)
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === "devices" && event.query.queryKey[1] === user.id) {
          const deviceList = event.query.state.data as Device[] | undefined;
          if (deviceList) {
            deviceList.forEach((device) => {
              if (!activeDeviceIds.has(device.id)) {
                setupPresenceChannelSingleton(device, user.id, queryClient);
              }
            });
          }
        }
      });

      return () => {
        subscriberCount--;
        unsubscribe();
        // 마지막 구독자가 해제될 때만 채널 정리
        if (subscriberCount <= 0) {
          cleanupAllChannels();
        }
      };
    }

    // 새 유저 또는 첫 설정 - 기존 것 정리 후 재생성
    if (activeUserId && activeUserId !== user.id) {
      cleanupAllChannels();
    }

    activeUserId = user.id;

    // DB 채널 설정
    const channelName = `devices-db-${user.id}`;
    const existingChannel = supabase.getChannels().find(ch => ch.topic === `realtime:${channelName}`);
    if (existingChannel) {
      activeDbChannel = existingChannel as ReturnType<typeof supabase.channel>;
    } else {
      activeDbChannel = supabase
        .channel(channelName, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `user_id=eq.${user.id}` },
          (payload) => {
            const updatedDevice = payload.new as Device;
            // Realtime 이벤트는 "방금 발생"한 것이므로 stale 체크 없이 그대로 신뢰
            if (updatedDevice.status === "online") {
              realtimeConfirmedOnline.add(updatedDevice.id);
            } else if (updatedDevice.status === "offline") {
              realtimeConfirmedOnline.delete(updatedDevice.id);
            }
            console.log("[Realtime] Device updated:", {
              id: updatedDevice.id,
              is_camera_connected: updatedDevice.is_camera_connected,
              status: updatedDevice.status,
            });
            queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.map((device) =>
                device.id === updatedDevice.id
                  ? { ...device, ...updatedDevice, is_camera_connected: updatedDevice.is_camera_connected ?? device.is_camera_connected }
                  : device
              );
            });
          }
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "devices", filter: `user_id=eq.${user.id}` },
          (payload) => {
            queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return [payload.new as Device];
              return [...oldDevices, payload.new as Device];
            });
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "devices", filter: `user_id=eq.${user.id}` },
          (payload) => {
            queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.filter((device) => device.id !== (payload.old as Device).id);
            });
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") console.error("[Realtime] DB channel error");
        });
    }

    // 초기 디바이스 Presence 채널 설정
    const currentDevices = queryClient.getQueryData<Device[]>(["devices", user.id]);
    if (currentDevices) {
      currentDevices.forEach((device) => {
        setupPresenceChannelSingleton(device, user.id, queryClient);
      });
    }

    // 새 디바이스가 추가될 때만 Presence 채널 설정
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "devices" && event.query.queryKey[1] === user.id) {
        const deviceList = event.query.state.data as Device[] | undefined;
        if (deviceList) {
          deviceList.forEach((device) => {
            if (!activeDeviceIds.has(device.id)) {
              setupPresenceChannelSingleton(device, user.id, queryClient);
            }
          });
        }
      }
    });

    return () => {
      subscriberCount--;
      unsubscribe();
      if (subscriberCount <= 0) {
        cleanupAllChannels();
      }
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
