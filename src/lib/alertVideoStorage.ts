/**
 * IndexedDB storage for alert recording videos.
 * Videos are stored as Blobs keyed by alert ID.
 */

const DB_NAME = "meercop_alert_videos";
const DB_VERSION = 1;
const STORE_NAME = "videos";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "alertId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAlertVideo(alertId: string, blob: Blob, mimeType: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ alertId, blob, mimeType, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAlertVideo(alertId: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(alertId);
    req.onsuccess = () => {
      const result = req.result;
      if (result) resolve({ blob: result.blob, mimeType: result.mimeType });
      else resolve(null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAlertVideo(alertId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(alertId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasAlertVideo(alertId: string): Promise<boolean> {
  const video = await getAlertVideo(alertId);
  return video !== null;
}
