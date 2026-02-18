const STORAGE_KEY = "meercop_activity_logs";
const PROCESSED_ALERT_IDS_KEY = "meercop_processed_alert_ids";
const MAX_LOGS = 50;
const MAX_PROCESSED_IDS = 200;

export type LocalAlertType = "intrusion" | "unauthorized_peripheral" | "location_change" | "offline" | "low_battery";

export interface LocalActivityLog {
  id: string;
  device_id: string;
  event_type: string;
  alert_type: LocalAlertType;
  event_data: Record<string, unknown> | null;
  created_at: string;
  device_name?: string;
  title: string;
  message: string | null;
  is_read: boolean;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function getActivityLogs(deviceId?: string, limit = 50): LocalActivityLog[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    let logs: LocalActivityLog[] = JSON.parse(stored);
    
    if (deviceId) {
      logs = logs.filter(log => log.device_id === deviceId);
    }
    
    return logs
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  } catch (error) {
    console.error("Error reading activity logs:", error);
    return [];
  }
}

export function addActivityLog(
  deviceId: string,
  eventType: string,
  options?: {
    eventData?: Record<string, unknown>;
    deviceName?: string;
    title?: string;
    message?: string | null;
    alertType?: LocalAlertType;
  }
): LocalActivityLog {
  const newLog: LocalActivityLog = {
    id: generateId(),
    device_id: deviceId,
    event_type: eventType,
    alert_type: options?.alertType || "intrusion",
    event_data: options?.eventData || null,
    created_at: new Date().toISOString(),
    device_name: options?.deviceName,
    title: options?.title || eventType,
    message: options?.message || null,
    is_read: false,
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let logs: LocalActivityLog[] = stored ? JSON.parse(stored) : [];
    
    logs.unshift(newLog);
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (error) {
    console.error("Error saving activity log:", error);
    // QuotaExceededError 발생 시 오래된 로그 삭제 후 재시도
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let logs: LocalActivityLog[] = stored ? JSON.parse(stored) : [];
      logs = logs.slice(0, 10); // 최근 10개만 유지
      logs.unshift(newLog);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch {
      // 그래도 실패하면 전체 삭제
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return newLog;
}

export function getAlertLogs(deviceId?: string, limit = 50): LocalActivityLog[] {
  const alertTypes = ["alert_shock", "alert_mouse", "alert_keyboard", "alert_movement", "intrusion"];
  const allLogs = getActivityLogs(deviceId, MAX_LOGS);
  return allLogs.filter(log => alertTypes.includes(log.event_type)).slice(0, limit);
}

export function clearActivityLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Error clearing activity logs:", error);
  }
}

export function markLogAsRead(logId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    
    const logs: LocalActivityLog[] = JSON.parse(stored);
    const updatedLogs = logs.map(log => 
      log.id === logId ? { ...log, is_read: true } : log
    );
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
  } catch (error) {
    console.error("Error marking log as read:", error);
  }
}

export function markAllLogsAsRead(deviceId?: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    
    const logs: LocalActivityLog[] = JSON.parse(stored);
    const updatedLogs = logs.map(log => 
      (!deviceId || log.device_id === deviceId) ? { ...log, is_read: true } : log
    );
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
  } catch (error) {
    console.error("Error marking all logs as read:", error);
  }
}

export function deleteActivityLog(logId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const logs: LocalActivityLog[] = JSON.parse(stored);
    const target = logs.find(l => l.id === logId);
    if (target?.event_data) {
      const alertId = (target.event_data as Record<string, unknown>).alertId as string | undefined;
      if (alertId) addProcessedAlertId(alertId);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.filter(l => l.id !== logId)));
  } catch (error) {
    console.error("Error deleting activity log:", error);
  }
}

export function deleteActivityLogs(logIds: string[]): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const idSet = new Set(logIds);
    const logs: LocalActivityLog[] = JSON.parse(stored);
    logs.forEach(l => {
      if (idSet.has(l.id) && l.event_data) {
        const alertId = (l.event_data as Record<string, unknown>).alertId as string | undefined;
        if (alertId) addProcessedAlertId(alertId);
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.filter(l => !idSet.has(l.id))));
  } catch (error) {
    console.error("Error deleting activity logs:", error);
  }
}

export function markLogsAsReadByIds(logIds: string[]): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const idSet = new Set(logIds);
    const logs: LocalActivityLog[] = JSON.parse(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      logs.map(l => idSet.has(l.id) ? { ...l, is_read: true } : l)
    ));
  } catch (error) {
    console.error("Error marking logs as read:", error);
  }
}

// ── 처리 완료된 alertId 추적 (Presence 재생성 방지) ──

export function addProcessedAlertId(alertId: string): void {
  try {
    const raw = localStorage.getItem(PROCESSED_ALERT_IDS_KEY);
    let ids: string[] = raw ? JSON.parse(raw) : [];
    if (ids.includes(alertId)) return;
    ids.push(alertId);
    if (ids.length > MAX_PROCESSED_IDS) ids = ids.slice(-MAX_PROCESSED_IDS);
    localStorage.setItem(PROCESSED_ALERT_IDS_KEY, JSON.stringify(ids));
  } catch {}
}

export function isAlertIdProcessed(alertId: string): boolean {
  try {
    const raw = localStorage.getItem(PROCESSED_ALERT_IDS_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as string[]).includes(alertId);
  } catch { return false; }
}
