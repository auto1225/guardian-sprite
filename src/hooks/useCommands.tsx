import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { broadcastCommand } from "@/lib/broadcastCommand";

type CommandType = Database["public"]["Enums"]["command_type"];
type Json = Database["public"]["Tables"]["commands"]["Insert"]["payload"];

export const useCommands = () => {
  const queryClient = useQueryClient();
  const { effectiveUserId } = useAuth();

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
    
    const { error } = await supabase.functions.invoke("update-device", {
      body: { device_id: deviceId, is_monitoring: enable },
    });
    
    if (error) {
      console.error("[useCommands] toggleMonitoring error:", error);
      throw error;
    }
    
    console.log("[useCommands] toggleMonitoring success, is_monitoring set to:", enable);
    
    if (effectiveUserId) {
      await broadcastCommand({
        userId: effectiveUserId,
        event: "monitoring_toggle",
        payload: { device_id: deviceId, is_monitoring: enable },
      });
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
    effectiveUserId,
  };
};
