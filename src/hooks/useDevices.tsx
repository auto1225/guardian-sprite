import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
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
const deviceChargingMap = new Map<string, boolean>(); // Presence-only: is_charging per deviceId
let subscriberCount = 0;

// ── 모듈 레벨 싱글톤: 기기 선택 상태 (모든 컴포넌트가 공유) ──
const SELECTED_DEVICE_STORAGE_KEY = "meercop_selected_device_id";
let _selectedDeviceId: string | null = localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY);
let _selectionInitialized = false;
const _selectionListeners = new Set<() => void>();

function getSelectedDeviceId() {
  return _selectedDeviceId;
}

function setGlobalSelectedDeviceId(id: string | null) {
  if (_selectedDeviceId === id) return;
  _selectedDeviceId = id;
  // ★ localStorage에 저장하여 새로고침 후에도 유지
  if (id) {
    localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(SELECTED_DEVICE_STORAGE_KEY);
  }
  _selectionListeners.forEach(l => l());
}

function subscribeSelection(listener: () => void) {
  _selectionListeners.add(listener);
  return () => { _selectionListeners.delete(listener); };
}

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
  const { user, effectiveUserId } = useAuth();
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading, error } = useQuery({
    queryKey: ["devices", effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return [];
      
      // Supabase Auth 세션이 있으면 직접 쿼리 (RLS 통과)
      if (user) {
        const { data, error } = await supabase
          .from("devices")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data as Device[];
      }
      
      // 시리얼 인증만 있을 때: get-devices Edge Function 사용 (RLS 우회)
      const { data, error } = await supabase.functions.invoke("get-devices", {
        body: { user_id: effectiveUserId },
      });
      if (error) throw error;
      return (data?.devices || []) as Device[];
    },
    enabled: !!effectiveUserId,
  });

  // 전역 싱글톤 선택 상태 사용
  const selectedDeviceId = useSyncExternalStore(subscribeSelection, getSelectedDeviceId);
  const setSelectedDeviceId = useCallback((id: string | null) => {
    setGlobalSelectedDeviceId(id);
  }, []);

  // 자동 선택: 유효한 기기가 선택되지 않았을 때만
  useEffect(() => {
    if (devices.length === 0) return;
    const nonSmartphones = devices.filter(d => d.device_type !== "smartphone");
    
    if (_selectedDeviceId) {
      const currentDevice = nonSmartphones.find(d => d.id === _selectedDeviceId);
      if (currentDevice) {
        _selectionInitialized = true;
        return;
      }
    }
    
    if (!_selectionInitialized || !_selectedDeviceId) {
      const mainDevice = nonSmartphones.find(d => (d.metadata as Record<string, unknown>)?.is_main);
      const target = mainDevice || nonSmartphones[0];
      if (target) {
        setGlobalSelectedDeviceId(target.id);
        _selectionInitialized = true;
      }
    }
  }, [devices]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;

  const addDevice = useMutation({
    mutationFn: async (device: Omit<DeviceInsert, "user_id">) => {
      if (!effectiveUserId) throw new Error("Not authenticated");
      if (user) {
        const { data, error } = await supabase
          .from("devices")
          .insert({ ...device, user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      // 시리얼 인증 시 Edge Function 필요 (향후 구현)
      throw new Error("Device creation requires auth session");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const updateDevice = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Device>) => {
      const { data, error } = await supabase.functions.invoke("update-device", {
        body: { device_id: id, ...updates },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const refreshDeviceStatus = async (deviceId?: string) => {
    if (!effectiveUserId) return;
    try {
      // Edge Function을 통해 기기 상태 새로고침
      const { data, error } = await supabase.functions.invoke("get-devices", {
        body: { user_id: effectiveUserId, device_id: deviceId },
      });
      if (error) { console.error("[Devices] Refresh error:", error); return; }
      const devices = data?.devices || [];
      if (devices.length > 0) {
        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return devices;
          return oldDevices.map((device) => {
            const updated = devices.find((d: Device) => d.id === device.id);
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
    if (!effectiveUserId) return;

    subscriberCount++;

    // 이미 같은 유저로 설정되어 있으면 스킵
    if (activeUserId === effectiveUserId) {
      return () => {
        subscriberCount--;
        if (subscriberCount <= 0) cleanupAllChannels();
      };
    }

    if (activeUserId && activeUserId !== effectiveUserId) cleanupAllChannels();
    activeUserId = effectiveUserId;

    // ── DB 변경 감지 채널 ──
    const dbChannelName = `devices-db-${effectiveUserId}`;
    const existingDbCh = supabase.getChannels().find(ch => ch.topic === `realtime:${dbChannelName}`);
    if (existingDbCh) {
      supabase.removeChannel(existingDbCh);
    }

    activeDbChannel = supabase
        .channel(dbChannelName, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            const updatedDevice = payload.new as Device;
            if (updatedDevice.device_type === "smartphone") return;
            if (updatedDevice.status === "online") realtimeConfirmedOnline.add(updatedDevice.id);
            else if (updatedDevice.status === "offline") realtimeConfirmedOnline.delete(updatedDevice.id);
            console.log("[Realtime] Device updated:", { id: updatedDevice.id, status: updatedDevice.status });
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.map((device) =>
                device.id === updatedDevice.id
                  ? { ...device, ...updatedDevice, is_camera_connected: updatedDevice.is_camera_connected ?? device.is_camera_connected }
                  : device
              );
            });
          }
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return [payload.new as Device];
              return [...oldDevices, payload.new as Device];
            });
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.filter((device) => device.id !== (payload.old as Device).id);
            });
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") console.error("[Realtime] DB channel error");
        });

    // ── 단일 Presence 채널: user-presence-{userId} ──
    const presenceChannelName = `user-presence-${effectiveUserId}`;
    const existingPresence = supabase.getChannels().find(ch => ch.topic === `realtime:${presenceChannelName}`);
    if (existingPresence) supabase.removeChannel(existingPresence);

    activePresenceChannel = supabase.channel(presenceChannelName);

    activePresenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = activePresenceChannel!.presenceState();
        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) => {
            if (d.device_type === "smartphone") return d;
            const entries = state[d.id] as Array<{
              status?: string;
              is_network_connected?: boolean;
              is_camera_connected?: boolean;
              battery_level?: number;
              is_charging?: boolean;
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

            if (latest.is_charging !== undefined) {
              deviceChargingMap.set(d.id, latest.is_charging);
            }

            const hasChanges = d.is_network_connected !== latest.is_network_connected || d.status !== newStatus || (latest.battery_level !== undefined && d.battery_level !== latest.battery_level);
            if (!hasChanges) return d;

            console.log("[Presence] ✅ Updating:", d.id.slice(0, 8), { status: `${d.status}→${newStatus}` });
            return {
              ...d,
              status: newStatus as Device["status"],
              is_network_connected: latest.is_network_connected ?? d.is_network_connected,
              battery_level: latest.battery_level ?? d.battery_level,
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
        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;
          return oldDevices.map((d) =>
            d.id === key
              ? { ...d, status: 'offline' as Device["status"], is_network_connected: false, is_camera_connected: false }
              : d
          );
        });
        console.log("[Presence] 🔴 Device left:", key.slice(0, 8), "→ offline (network/camera off)");

        const timer = setTimeout(() => {
          activeLeaveTimers.delete(key);
          supabase.functions.invoke("get-devices", {
            body: { user_id: effectiveUserId, device_id: key },
          }).then(({ data }) => {
            const device = data?.devices?.[0];
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.map((d) =>
                d.id === key
                  ? {
                      ...d,
                      status: (device?.status ?? 'offline') as Device["status"],
                      is_network_connected: device?.is_network_connected ?? false,
                      is_camera_connected: device?.is_camera_connected ?? d.is_camera_connected,
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

    // ── 네트워크 복구 시 채널 재연결 ──
    const handleReconnect = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const name = detail?.name;
      if (name === dbChannelName || name === presenceChannelName) {
        console.log("[useDevices] ♻️ Reconnecting channel:", name);
        cleanupAllChannels();
        activeUserId = null;
        queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
      }
    };
    window.addEventListener('channelmanager:reconnect', handleReconnect);

    return () => {
      subscriberCount--;
      if (subscriberCount <= 0) cleanupAllChannels();
      window.removeEventListener('channelmanager:reconnect', handleReconnect);
    };
  }, [effectiveUserId, queryClient]);

  const getDeviceCharging = useCallback((deviceId: string): boolean => {
    return deviceChargingMap.get(deviceId) ?? false;
  }, []);

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
    getDeviceCharging,
  };
};
