import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface PlanCapabilities {
  /** Current best active plan: free | basic | premium */
  activePlan: string;
  /** Whether any serial is active (not expired) */
  isActive: boolean;
  /** Feature flags derived from plan */
  canUseCamera: boolean;
  canUseStealth: boolean;
  canUseRemoteAlarm: boolean;
  canUseLocationTracking: boolean;
  canUsePeripheralMonitoring: boolean;
  canUseLiveStreaming: boolean;
  canUsePhotoCapture: boolean;
  maxDevices: number;
}

const PLAN_HIERARCHY: Record<string, number> = {
  free: 0,
  basic: 1,
  premium: 2,
};

/**
 * Derives feature capabilities from the user's active serials.
 * No hardcoding — all features are gated by the best active plan_type.
 */
export function usePlanCapabilities(): PlanCapabilities {
  const { serials } = useAuth();

  return useMemo(() => {
    const now = new Date();

    // Find the best active plan among all serials
    const activeSerials = serials.filter((s) => {
      if (s.status === "expired") return false;
      if (s.expires_at && new Date(s.expires_at) < now) return false;
      return true;
    });

    const isActive = activeSerials.length > 0;

    // Get highest plan tier
    let bestPlan = "free";
    for (const s of activeSerials) {
      const tier = PLAN_HIERARCHY[s.plan_type] ?? 0;
      if (tier > (PLAN_HIERARCHY[bestPlan] ?? 0)) {
        bestPlan = s.plan_type;
      }
    }

    const isBasicOrAbove = (PLAN_HIERARCHY[bestPlan] ?? 0) >= 1;
    const isPremium = (PLAN_HIERARCHY[bestPlan] ?? 0) >= 2;

    return {
      activePlan: bestPlan,
      isActive,
      // Free: basic monitoring only
      canUseLocationTracking: isActive,
      canUseRemoteAlarm: isActive,
      // Basic+: stealth mode, peripheral monitoring
      canUseStealth: isBasicOrAbove,
      canUsePeripheralMonitoring: isBasicOrAbove,
      // Premium: camera, live streaming, photo capture
      canUseCamera: isPremium,
      canUseLiveStreaming: isPremium,
      canUsePhotoCapture: isPremium,
      maxDevices: isPremium ? 10 : isBasicOrAbove ? 3 : 1,
    };
  }, [serials]);
}