import { useAuth } from "@/hooks/useAuth";
import type { ServerCapabilities } from "@/lib/websiteAuth";

const CAPS_CACHE_KEY = "meercop_capabilities";

/**
 * Server-driven plan capabilities hook.
 *
 * - All feature flags come from the server's `capabilities` JSONB object.
 * - Missing boolean keys → false, missing number keys → 0.
 * - Cached in localStorage for offline fallback.
 * - No hardcoded plan-to-feature mapping in the app.
 */
export function usePlanCapabilities() {
  const { capabilities } = useAuth();

  // Use server caps, falling back to localStorage cache
  const caps: ServerCapabilities =
    Object.keys(capabilities).length > 0
      ? capabilities
      : loadCachedCapabilities();

  // Cache whenever we get fresh server data
  if (Object.keys(capabilities).length > 0) {
    try {
      localStorage.setItem(CAPS_CACHE_KEY, JSON.stringify(capabilities));
    } catch {
      // storage full — ignore
    }
  }

  return {
    /** Raw capabilities object from server */
    raw: caps,
    /** Check a boolean capability (missing = false) */
    can: (key: string): boolean => caps[key] === true,
    /** Get a numeric capability (missing = 0) */
    limit: (key: string): number => {
      const v = caps[key];
      return typeof v === "number" ? v : 0;
    },
    /** Whether any capabilities were loaded (server or cache) */
    hasCapabilities: Object.keys(caps).length > 0,
  };
}

function loadCachedCapabilities(): ServerCapabilities {
  try {
    const cached = localStorage.getItem(CAPS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {
    // corrupted — ignore
  }
  return {};
}

/** Clear cached capabilities (call on sign-out) */
export function clearCapabilitiesCache() {
  localStorage.removeItem(CAPS_CACHE_KEY);
}
