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
    // Update device monitoring status
    const { error } = await supabase
      .from("devices")
      .update({ is_monitoring: enable })
      .eq("id", deviceId);
    
    if (error) throw error;
    
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
