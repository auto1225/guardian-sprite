import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { 
  addActivityLog, 
  getAlertLogs, 
  markLogAsRead, 
  markAllLogsAsRead,
  LocalActivityLog,
  LocalAlertType 
} from "@/lib/localActivityLogs";

export interface ActiveAlert {
  id: string;
  type: LocalAlertType;
  title: string;
  message: string | null;
  created_at: string;
}

export const useAlerts = (deviceId?: string | null) => {
  const [alerts, setAlerts] = useState<LocalActivityLog[]>([]);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 로컬 저장소에서 알림 로그 로드
  const loadAlerts = useCallback(() => {
    if (!deviceId) {
      setAlerts([]);
      setIsLoading(false);
      return;
    }
    
    const logs = getAlertLogs(deviceId, 50);
    setAlerts(logs);
    setIsLoading(false);
  }, [deviceId]);

  // 읽지 않은 알림 개수
  const unreadCount = alerts.filter(a => !a.is_read).length;

  // 초기 로드
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Presence 채널 구독 (노트북에서 보내는 실시간 알림 수신)
  useEffect(() => {
    if (!deviceId) return;

    const channel = supabase.channel(`device-alerts-${deviceId}`);
    
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log("[useAlerts] Presence sync:", state);
        
        // 노트북에서 보낸 알림 상태 확인
        const laptopState = state[deviceId]?.[0] as { active_alert?: ActiveAlert } | undefined;
        if (laptopState?.active_alert) {
          console.log("[useAlerts] Active alert received:", laptopState.active_alert);
          setActiveAlert(laptopState.active_alert);
          
          // 로컬 로그에 저장
          addActivityLog(deviceId, laptopState.active_alert.type, {
            title: laptopState.active_alert.title,
            message: laptopState.active_alert.message,
            alertType: laptopState.active_alert.type,
          });
          
          // 알림 목록 갱신
          loadAlerts();
        } else {
          // 알림이 해제됨
          setActiveAlert(null);
        }
      })
      .subscribe((status) => {
        console.log("[useAlerts] Channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, loadAlerts]);

  // 알림 읽음 처리
  const markAsRead = {
    mutate: (alertId: string) => {
      markLogAsRead(alertId);
      loadAlerts();
    },
  };

  const markAllAsRead = {
    mutate: () => {
      if (deviceId) {
        markAllLogsAsRead(deviceId);
        loadAlerts();
      }
    },
  };

  // 활성 알림 해제
  const dismissActiveAlert = useCallback(() => {
    setActiveAlert(null);
  }, []);

  return {
    alerts,
    activeAlert,
    unreadCount,
    isLoading,
    error: null,
    markAsRead,
    markAllAsRead,
    dismissActiveAlert,
    refreshAlerts: loadAlerts,
  };
};
