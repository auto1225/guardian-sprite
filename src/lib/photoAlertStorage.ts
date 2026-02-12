const STORAGE_KEY = "meercop_photo_alerts";
const MAX_ALERTS = 20;

export type PhotoEventType = "camera_motion" | "keyboard" | "mouse" | "lid" | "power";

export interface PhotoAlert {
  id: string;
  device_id: string;
  event_type: PhotoEventType;
  total_photos: number;
  change_percent?: number;
  photos: string[]; // base64 dataURLs
  created_at: string;
  is_read: boolean;
}

export function getPhotoAlerts(deviceId?: string): PhotoAlert[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    let alerts: PhotoAlert[] = JSON.parse(stored);
    if (deviceId) {
      alerts = alerts.filter((a) => a.device_id === deviceId);
    }
    return alerts.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch {
    return [];
  }
}

export function savePhotoAlert(alert: PhotoAlert): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let alerts: PhotoAlert[] = stored ? JSON.parse(stored) : [];
    // Deduplicate
    alerts = alerts.filter((a) => a.id !== alert.id);
    alerts.unshift(alert);
    if (alerts.length > MAX_ALERTS) {
      alerts = alerts.slice(0, MAX_ALERTS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch (e) {
    console.error("[PhotoAlertStorage] Save error:", e);
  }
}

export function deletePhotoAlert(alertId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const alerts: PhotoAlert[] = JSON.parse(stored);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(alerts.filter((a) => a.id !== alertId))
    );
  } catch (e) {
    console.error("[PhotoAlertStorage] Delete error:", e);
  }
}

export function markPhotoAlertRead(alertId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const alerts: PhotoAlert[] = JSON.parse(stored);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(alerts.map((a) => (a.id === alertId ? { ...a, is_read: true } : a)))
    );
  } catch (e) {
    console.error("[PhotoAlertStorage] Mark read error:", e);
  }
}
