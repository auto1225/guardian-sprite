import { useAuth } from "@/hooks/useAuth";
import type { ServerCapabilities, PlanCapabilitiesMap } from "@/lib/websiteAuth";

const CAPS_CACHE_KEY = "meercop_capabilities";
const PLAN_CAPS_CACHE_KEY = "meercop_plan_capabilities";

/**
 * Server-driven plan capabilities hook.
 *
 * When serialKey is provided, looks up the serial's plan_type
 * and returns that specific plan's capabilities (per-device gating).
 * Falls back to merged (highest plan) capabilities when no serialKey given.
 */
export function usePlanCapabilities(serialKey?: string) {
  const { capabilities, planCapabilities, serials } = useAuth();

  // Determine which capabilities to use
  let caps: ServerCapabilities;
  let planType: string | undefined;

  if (serialKey && Object.keys(planCapabilities).length > 0) {
    // Find the serial's plan_type
    const matchedSerial = serials.find(s => s.serial_key === serialKey);
    planType = matchedSerial?.plan_type;

    if (planType && planCapabilities[planType]) {
      caps = planCapabilities[planType];
    } else {
      // Fallback to merged capabilities
      caps = Object.keys(capabilities).length > 0 ? capabilities : loadCachedCapabilities();
    }
  } else {
    // No serial context — use merged (highest plan) capabilities
    caps = Object.keys(capabilities).length > 0 ? capabilities : loadCachedCapabilities();
  }

  // Cache whenever we get fresh server data
  if (Object.keys(capabilities).length > 0) {
    try {
      localStorage.setItem(CAPS_CACHE_KEY, JSON.stringify(capabilities));
    } catch { /* storage full */ }
  }
  if (Object.keys(planCapabilities).length > 0) {
    try {
      localStorage.setItem(PLAN_CAPS_CACHE_KEY, JSON.stringify(planCapabilities));
    } catch { /* storage full */ }
  }

  return {
    raw: caps,
    planType,
    can: (key: string): boolean => caps[key] === true,
    limit: (key: string): number => {
      const v = caps[key];
      return typeof v === "number" ? v : 0;
    },
    hasCapabilities: Object.keys(caps).length > 0,
  };
}

function loadCachedCapabilities(): ServerCapabilities {
  try {
    const cached = localStorage.getItem(CAPS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch { /* corrupted */ }
  return {};
}

/** Clear cached capabilities (call on sign-out) */
export function clearCapabilitiesCache() {
  localStorage.removeItem(CAPS_CACHE_KEY);
  localStorage.removeItem(PLAN_CAPS_CACHE_KEY);
}
