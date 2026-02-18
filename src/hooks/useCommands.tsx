import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

type CommandType = Database["public"]["Enums"]["command_type"];
type Json = Database["public"]["Tables"]["commands"]["Insert"]["payload"];

export const useCommands = () => {
  const queryClient = useQueryClient();

  const sendCommand = useMutation({
    mutationFn: async ({
      deviceId,
      commandType,
      payload,
    }: {
      deviceId: string;
      commandType: CommandType;
      payload?: Json;
    }) => {
      const { data, error } = await supabase
        .from("commands")
        .insert({
          device_id: deviceId,
          command_type: commandType,
          payload,
          status: "pending",
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commands"] });
    },
  });

  const toggleMonitoring = async (deviceId: string, enable: boolean) => {
    console.log("[useCommands] toggleMonitoring called:", deviceId, "enable:", enable);
    
    // Update device monitoring status in DB
    const { error } = await supabase
      .from("devices")
      .update({ is_monitoring: enable })
      .eq("id", deviceId);
    
    if (error) {
      console.error("[useCommands] toggleMonitoring error:", error);
      throw error;
    }
    
    console.log("[useCommands] toggleMonitoring success, is_monitoring set to:", enable);
    
    // Broadcast to laptop via Realtime channel (laptop can't use postgres_changes due to RLS)
    const channel = supabase.channel(`device-commands-${deviceId}-${Date.now()}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { supabase.removeChannel(channel); reject(new Error("Channel timeout")); }, 5000);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            channel.send({
              type: "broadcast",
              event: "monitoring_toggle",
              payload: { device_id: deviceId, is_monitoring: enable },
            }).then(() => {
              console.log("[useCommands] Broadcast monitoring_toggle sent:", { deviceId, enable });
              supabase.removeChannel(channel);
              resolve();
            });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timeout);
            supabase.removeChannel(channel);
            reject(new Error(status));
          }
        });
      });
    } catch (err) {
      console.warn("[useCommands] Broadcast failed (DB update succeeded):", err);
    }
    
    queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  const sendAlarm = (deviceId: string) => {
    return sendCommand.mutateAsync({
      deviceId,
      commandType: "alarm",
    });
  };

  const captureCamera = (deviceId: string) => {
    return sendCommand.mutateAsync({
      deviceId,
      commandType: "camera_capture",
    });
  };

  const lockDevice = (deviceId: string) => {
    return sendCommand.mutateAsync({
      deviceId,
      commandType: "lock",
    });
  };

  const locateDevice = (deviceId: string) => {
    return sendCommand.mutateAsync({
      deviceId,
      commandType: "locate",
    });
  };

  const sendMessage = (deviceId: string, message: string) => {
    return sendCommand.mutateAsync({
      deviceId,
      commandType: "message",
      payload: { message },
    });
  };

  return {
    sendCommand,
    toggleMonitoring,
    sendAlarm,
    captureCamera,
    lockDevice,
    locateDevice,
    sendMessage,
  };
};
