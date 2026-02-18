// src/types/global.d.ts
// S-14: TypeScript 타입 선언 — `as any` 제거를 위한 글로벌 타입

/** Badging API */
interface Navigator {
  clearAppBadge?: () => Promise<void>;
  setAppBadge?: (count?: number) => Promise<void>;
  getBattery?: () => Promise<BatteryManager>;
}

interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  readonly chargingTime: number;
  readonly dischargingTime: number;
  readonly level: number;
}

/** File System Access API */
interface Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}
