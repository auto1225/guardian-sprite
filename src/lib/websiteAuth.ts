import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { safeStorage } from "@/lib/safeStorage";

const WEBSITE_SUPABASE_URL =
  import.meta.env.VITE_WEB_SUPABASE_URL || "https://peqgmuicrorjvvburqly.supabase.co";
const WEBSITE_ANON_KEY =
  import.meta.env.VITE_WEB_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlcWdtdWljcm9yanZ2YnVycWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDA1NzQsImV4cCI6MjA4NzUxNjU3NH0.e5HYG3dSMqhm4ahT-en-nNX2mD95KM_TdKIlfuzdMc4";

const safeWebStorage: SupportedStorage = {
  getItem: (key: string) => safeStorage.getItem(key),
  setItem: (key: string, value: string) => {
    safeStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    safeStorage.removeItem(key);
  },
};

export const websiteSupabase = createClient(WEBSITE_SUPABASE_URL, WEBSITE_ANON_KEY, {
  auth: {
    storageKey: "meercop-website-auth",
    storage: safeWebStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export { WEBSITE_SUPABASE_URL, WEBSITE_ANON_KEY };

export interface UserSerial {
  id: string;
  serial_key: string;
  plan_type: string;
  status: string;
  device_name: string | null;
  remaining_days: number | null;
  expires_at: string | null;
}

/** Server-driven capabilities — flat JSONB with boolean/number values */
export type ServerCapabilities = Record<string, boolean | number>;

/** Per-plan capabilities map: { free: {...}, basic: {...}, premium: {...} } */
export type PlanCapabilitiesMap = Record<string, ServerCapabilities>;

export interface FetchSerialsResult {
  serials: UserSerial[];
  capabilities: ServerCapabilities;
  plan_capabilities: PlanCapabilitiesMap;
}

export async function fetchUserSerials(accessToken: string): Promise<FetchSerialsResult> {
  try {
    const res = await fetch(`${WEBSITE_SUPABASE_URL}/functions/v1/verify-serial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: WEBSITE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: "get_user_serials" }),
    });
    if (!res.ok) return { serials: [], capabilities: {}, plan_capabilities: {} };
    const data = await res.json();
    return {
      serials: data.serials || [],
      capabilities: data.capabilities || {},
      plan_capabilities: data.plan_capabilities || {},
    };
  } catch {
    return { serials: [], capabilities: {}, plan_capabilities: {} };
  }
}
