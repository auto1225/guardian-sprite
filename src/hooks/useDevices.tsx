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

  // Subscribe to realtime updates - 즉시 상태 업데이트
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("devices-realtime")
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
          // 즉시 캐시 업데이트 (refetch 없이)
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
        console.log("[Realtime] Devices channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
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
