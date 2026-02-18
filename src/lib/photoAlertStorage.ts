// src/lib/photoAlertStorage.ts
// S-11: IndexedDB 기반 사진 경보 저장소 (localStorage 용량 제한 해결)

const DB_NAME = "meercop_photo_alerts";
const DB_VERSION = 1;
const STORE_NAME = "alerts";
const MAX_ALERTS = 20;
const DELETED_IDS_KEY = "meercop_deleted_photo_ids";

// Legacy localStorage key for migration
const LEGACY_STORAGE_KEY = "meercop_photo_alerts";

export type PhotoEventType = "camera_motion" | "keyboard" | "mouse" | "lid" | "power";

export interface PhotoAlert {
  id: string;
  device_id: string;
  device_name?: string;
  event_type: PhotoEventType;
  total_photos: number;
  change_percent?: number;
  photos: string[]; // base64 dataURLs
  created_at: string;
  is_read: boolean;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: string | null;
  auto_streaming?: boolean;
}

// ── IndexedDB 헬퍼 ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("created_at", "created_at", { unique: false });
        store.createIndex("device_id", "device_id", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── localStorage → IndexedDB 마이그레이션 ──

async function migrateFromLocalStorage(): Promise<void> {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return;

    const alerts: PhotoAlert[] = JSON.parse(stored);
    if (!alerts.length) return;

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const alert of alerts) {
      store.put(alert);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    localStorage.removeItem(LEGACY_STORAGE_KEY);
    console.log("[PhotoAlertStorage] ✅ Migrated", alerts.length, "alerts from localStorage to IndexedDB");
    db.close();
  } catch (err) {
    console.warn("[PhotoAlertStorage] Migration failed, keeping localStorage:", err);
  }
}

// 앱 시작 시 마이그레이션 실행
let migrationDone = false;
async function ensureMigration(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  await migrateFromLocalStorage();
}

// ── 삭제된 ID 추적 (새로고침 시 복원 방지) ──

function getDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function addDeletedId(id: string): void {
  try {
    const ids = getDeletedIds();
    ids.add(id);
    // 최대 200개 유지
    const arr = Array.from(ids).slice(-200);
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(arr));
  } catch {}
}

// ── In-memory 캐시 (동기 API 호환) ──

let cachedAlerts: PhotoAlert[] = [];
let cacheLoaded = false;

async function loadCache(): Promise<void> {
  await ensureMigration();
  const deletedIds = getDeletedIds();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    const alerts = await new Promise<PhotoAlert[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    cachedAlerts = alerts
      .filter(a => !deletedIds.has(a.id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    cacheLoaded = true;
    db.close();

    // DB에서도 삭제된 항목 정리
    if (deletedIds.size > 0) {
      _deleteFromDB(Array.from(deletedIds));
    }
  } catch (err) {
    console.error("[PhotoAlertStorage] IndexedDB load failed, falling back:", err);
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
      cachedAlerts = stored ? JSON.parse(stored) : [];
      cachedAlerts = cachedAlerts.filter(a => !deletedIds.has(a.id));
    } catch {
      cachedAlerts = [];
    }
    cacheLoaded = true;
  }
}

// 초기 로드 — 앱 시작 시 캐시 채움
const initPromise = loadCache();

// ── 공개 API (동기 — 캐시 기반) ──

export function getPhotoAlerts(deviceId?: string): PhotoAlert[] {
  let alerts = [...cachedAlerts];
  if (deviceId) {
    alerts = alerts.filter((a) => a.device_id === deviceId);
  }
  return alerts;
}

export function savePhotoAlert(alert: PhotoAlert): void {
  // 삭제된 ID면 저장하지 않음
  if (getDeletedIds().has(alert.id)) {
    console.log("[PhotoAlertStorage] ⏭ Skipping save for deleted alert:", alert.id);
    return;
  }

  // 캐시 업데이트
  cachedAlerts = cachedAlerts.filter((a) => a.id !== alert.id);
  cachedAlerts.unshift(alert);
  if (cachedAlerts.length > MAX_ALERTS) {
    const removed = cachedAlerts.splice(MAX_ALERTS);
    // 초과분 DB에서도 삭제
    _deleteFromDB(removed.map(r => r.id));
  }

  // 비동기 DB 저장
  _saveToDB(alert);
}

export function deletePhotoAlert(alertId: string): void {
  cachedAlerts = cachedAlerts.filter((a) => a.id !== alertId);
  addDeletedId(alertId); // 영구 기록 — 새로고침 후에도 복원 방지
  _deleteFromDB([alertId]);
}

export function markPhotoAlertRead(alertId: string): void {
  const alert = cachedAlerts.find((a) => a.id === alertId);
  if (alert) {
    alert.is_read = true;
    _saveToDB(alert);
  }
}

/** 캐시를 DB에서 다시 로드 (외부에서 호출 가능) */
export async function refreshPhotoAlertCache(): Promise<void> {
  await loadCache();
}

// ── 비동기 DB 쓰기 (fire-and-forget) ──

async function _saveToDB(alert: PhotoAlert): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(alert);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error("[PhotoAlertStorage] DB save error:", err);
  }
}

async function _deleteFromDB(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error("[PhotoAlertStorage] DB delete error:", err);
  }
}
