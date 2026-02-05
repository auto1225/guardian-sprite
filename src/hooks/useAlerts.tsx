import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { Database } from "@/integrations/supabase/types";

type Alert = Database["public"]["Tables"]["alerts"]["Row"];

export const useAlerts = (deviceId?: string | null) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading, error } = useQuery({
    queryKey: ["alerts", deviceId],
    queryFn: async () => {
      if (!deviceId) return [];
      
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as Alert[];
    },
    enabled: !!deviceId,
  });

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  const markAsRead = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("alerts")
        .update({ is_read: true })
        .eq("id", alertId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts", deviceId] });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!deviceId) return;
      const { error } = await supabase
        .from("alerts")
        .update({ is_read: true })
        .eq("device_id", deviceId)
        .eq("is_read", false);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts", deviceId] });
    },
  });

  // Subscribe to realtime alerts
  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase
      .channel("alerts-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["alerts", deviceId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, queryClient]);

  return {
    alerts,
    unreadCount,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
  };
};
