import { safeStorage } from "@/lib/safeStorage";

// Background preset definitions and localStorage helpers

export interface BackgroundOption {
  id: string;
  type: "default" | "gradient" | "solid" | "custom";
  value: string;
  labelKey: string;
}

export const BACKGROUND_PRESETS: BackgroundOption[] = [
  { id: "default", type: "default", value: "__default__", labelKey: "bg.default" },
  { id: "sunset", type: "gradient", value: "linear-gradient(180deg, #ff7e5f 0%, #feb47b 50%, #86677B 100%)", labelKey: "bg.sunset" },
  { id: "night", type: "gradient", value: "linear-gradient(180deg, #0f0c29 0%, #302b63 50%, #24243e 100%)", labelKey: "bg.night" },
  { id: "forest", type: "gradient", value: "linear-gradient(180deg, #134e5e 0%, #71b280 100%)", labelKey: "bg.forest" },
  { id: "ocean", type: "gradient", value: "linear-gradient(180deg, #2193b0 0%, #6dd5ed 100%)", labelKey: "bg.ocean" },
  { id: "aurora", type: "gradient", value: "linear-gradient(180deg, #0B486B 0%, #F56217 100%)", labelKey: "bg.aurora" },
];

const SELECTION_KEY = "meercop-bg-selection";
const CUSTOM_BG_KEY = "meercop-custom-bg";

export function getSelectedBackgroundId(): string {
  return safeStorage.getItem(SELECTION_KEY) || "default";
}

export function getSelectedBackground(): { id: string; value: string } {
  const id = getSelectedBackgroundId();
  if (id === "custom") {
    const customUrl = safeStorage.getItem(CUSTOM_BG_KEY) || "";
    return { id, value: customUrl || "__default__" };
  }
  const preset = BACKGROUND_PRESETS.find(p => p.id === id);
  return { id, value: preset?.value || "__default__" };
}

export function selectPreset(id: string): void {
  safeStorage.setItem(SELECTION_KEY, id);
}

export function saveCustomBackground(dataUrl: string): void {
  safeStorage.setItem(CUSTOM_BG_KEY, dataUrl);
  safeStorage.setItem(SELECTION_KEY, "custom");
}

export function deleteCustomBackground(): void {
  safeStorage.removeItem(CUSTOM_BG_KEY);
  safeStorage.setItem(SELECTION_KEY, "default");
}

export function getCustomBackground(): string | null {
  return safeStorage.getItem(CUSTOM_BG_KEY);
}
