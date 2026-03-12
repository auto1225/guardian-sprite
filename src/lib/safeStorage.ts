const memoryStorage = new Map<string, string>();

function getPersistentStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  getItem(key: string): string | null {
    const storage = getPersistentStorage();

    if (storage) {
      try {
        return storage.getItem(key);
      } catch {
        // fall through to memory storage
      }
    }

    return memoryStorage.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const storage = getPersistentStorage();

    if (storage) {
      try {
        storage.setItem(key, value);
        return;
      } catch {
        // fall through to memory storage
      }
    }

    memoryStorage.set(key, value);
  },

  removeItem(key: string): void {
    const storage = getPersistentStorage();

    if (storage) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore and clean memory fallback too
      }
    }

    memoryStorage.delete(key);
  },

  isPersistentAvailable(): boolean {
    return getPersistentStorage() !== null;
  },
};
