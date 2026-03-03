import { createClient } from "@supabase/supabase-js";

const WEBSITE_SUPABASE_URL = "https://peqgmuicrorjvvburqly.supabase.co";
const WEBSITE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlcWdtdWljcm9yanZ2YnVycWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDA1NzQsImV4cCI6MjA4NzUxNjU3NH0.e5HYG3dSMqhm4ahT-en-nNX2mD95KM_TdKIlfuzdMc4";

export const websiteSupabase = createClient(WEBSITE_SUPABASE_URL, WEBSITE_ANON_KEY, {
  auth: {
    storageKey: "meercop-website-auth",
    storage: localStorage,
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

export interface FetchSerialsResult {
  serials: UserSerial[];
  capabilities: ServerCapabilities;
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
    if (!res.ok) return { serials: [], capabilities: {} };
    const data = await res.json();
    return {
      serials: data.serials || [],
      capabilities: data.capabilities || {},
    };
  } catch {
    return { serials: [], capabilities: {} };
  }
}
