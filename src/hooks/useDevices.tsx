import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

// ── 모듈 레벨 싱글톤: 사용자당 단일 Presence 채널 ──
let activeUserId: string | null = null;
let activeDbChannel: ReturnType<typeof supabase.channel> | null = null;
let activePresenceChannel: ReturnType<typeof supabase.channel> | null = null;
const activeLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const realtimeConfirmedOnline = new Set<string>();
let subscriberCount = 0;

function cleanupAllChannels() {
  activeLeaveTimers.forEach((timer) => clearTimeout(timer));
  activeLeaveTimers.clear();
  if (activeDbChannel) {
    supabase.removeChannel(activeDbChannel);
    activeDbChannel = null;
  }
  if (activePresenceChannel) {
    supabase.removeChannel(activePresenceChannel);
    activePresenceChannel = null;
  }
  realtimeConfirmedOnline.clear();
  activeUserId = null;
  subscriberCount = 0;
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
      
      return data as Device[];
    },
    enabled: !!user,
  });

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    if (devices.length === 0) return;
    const nonSmartphones = devices.filter(d => d.device_type !== "smartphone");
    
    // 이미 유효한 비-스마트폰 기기가 선택되어 있으면 변경하지 않음
    if (selectedDeviceId) {
      const currentDevice = nonSmartphones.find(d => d.id === selectedDeviceId);
      if (currentDevice) return; // 유효한 선택 유지
    }
    
    // 선택된 기기가 없거나 유효하지 않을 때만 자동 선택
    const mainDevice = nonSmartphones.find(d => (d.metadata as Record<string, unknown>)?.is_main);
    const target = mainDevice || nonSmartphones[0];
    if (target) {
      setSelectedDeviceId(target.id);
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
      const { error } = await supabase.from("devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", user?.id] });
    },
  });

  const refreshDeviceStatus = async (deviceId?: string) => {
    if (!user) return;
    try {
      const query = supabase.from("devices").select("*").eq("user_id", user.id);
      if (deviceId) query.eq("id", deviceId);
      const { data, error } = await query;
      if (error) { console.error("[Devices] Refresh error:", error); return; }
      if (data && data.length > 0) {
        queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return data;
          return oldDevices.map((device) => {
            const updated = data.find((d) => d.id === device.id);
            return updated ? { ...device, ...updated } : device;
          });
        });
      }
    } catch (err) {
      console.error("[Devices] Refresh failed:", err);
    }
  };

  // ── Realtime 구독: 사용자당 단일 Presence 채널 ──
  useEffect(() => {
    if (!user) return;

    subscriberCount++;

    // 이미 같은 유저로 설정되어 있으면 스킵
    if (activeUserId === user.id) {
      return () => {
        subscriberCount--;
        if (subscriberCount <= 0) cleanupAllChannels();
      };
    }

    if (activeUserId && activeUserId !== user.id) cleanupAllChannels();
    activeUserId = user.id;

    // ── DB 변경 감지 채널 ──
    const dbChannelName = `devices-db-${user.id}`;
    const existingDbCh = supabase.getChannels().find(ch => ch.topic === `realtime:${dbChannelName}`);
    if (existingDbCh) {
      supabase.removeChannel(existingDbCh);
    }

    activeDbChannel = supabase
        .channel(dbChannelName, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `user_id=eq.${user.id}` },
          (payload) => {
            const updatedDevice = payload.new as Device;
            if (updatedDevice.status === "online") realtimeConfirmedOnline.add(updatedDevice.id);
            else if (updatedDevice.status === "offline") realtimeConfirmedOnline.delete(updatedDevice.id);
            console.log("[Realtime] Device updated:", { id: updatedDevice.id, status: updatedDevice.status });
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

    // ── 단일 Presence 채널: user-presence-{userId} ──
    // 모든 노트북이 이 채널에 join하고 key=deviceId로 track
    const presenceChannelName = `user-presence-${user.id}`;
    const existingPresence = supabase.getChannels().find(ch => ch.topic === `realtime:${presenceChannelName}`);
    if (existingPresence) supabase.removeChannel(existingPresence);

    activePresenceChannel = supabase.channel(presenceChannelName);

    activePresenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = activePresenceChannel!.presenceState();
        queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) => {
            if (d.device_type === "smartphone") return d;
            const entries = state[d.id] as Array<{
              status?: string;
              is_network_connected?: boolean;
              is_camera_connected?: boolean;
              last_seen_at?: string;
            }> | undefined;
            if (!entries || entries.length === 0) return d;

            const latest = entries.reduce((a, b) => {
              const aT = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
              const bT = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
              return bT > aT ? b : a;
            });

            const newStatus = latest.status === 'online' ? 'online' : 'offline';
            if (newStatus === 'online') realtimeConfirmedOnline.add(d.id);
            else realtimeConfirmedOnline.delete(d.id);

            const hasChanges = d.is_network_connected !== latest.is_network_connected || d.status !== newStatus;
            if (!hasChanges) return d;

            console.log("[Presence] ✅ Updating:", d.id.slice(0, 8), { status: `${d.status}→${newStatus}` });
            return {
              ...d,
              status: newStatus as Device["status"],
              is_network_connected: latest.is_network_connected ?? d.is_network_connected,
            };
          });
        });
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        const timer = activeLeaveTimers.get(key);
        if (timer) { clearTimeout(timer); activeLeaveTimers.delete(key); }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        const existingTimer = activeLeaveTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        realtimeConfirmedOnline.delete(key);
        queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) =>
            d.id === key
              ? { ...d, status: 'offline' as Device["status"], is_network_connected: false }
              : d
          );
        });

        const timer = setTimeout(() => {
          activeLeaveTimers.delete(key);
          supabase
            .from("devices")
            .select("status, is_camera_connected, is_network_connected")
            .eq("id", key)
            .maybeSingle()
            .then(({ data }) => {
              queryClient.setQueryData(["devices", user.id], (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.map((d) =>
                  d.id === key
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
        activeLeaveTimers.set(key, timer);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.error("[Presence] Channel error");
      });

    return () => {
      subscriberCount--;
      if (subscriberCount <= 0) cleanupAllChannels();
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
    refreshDeviceStatus,
  };
};
