const STORAGE_KEY = "meercop_activity_logs";
const MAX_LOGS = 200;

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
  }

  return newLog;
}

export function getAlertLogs(deviceId: string, limit = 50): LocalActivityLog[] {
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

export function markAllLogsAsRead(deviceId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    
    const logs: LocalActivityLog[] = JSON.parse(stored);
    const updatedLogs = logs.map(log => 
      log.device_id === deviceId ? { ...log, is_read: true } : log
    );
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
  } catch (error) {
    console.error("Error marking all logs as read:", error);
  }
}
