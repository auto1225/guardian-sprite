import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { usePlanCapabilities } from "@/hooks/usePlanCapabilities";
import { useCallback } from "react";

const PLAN_LABELS: Record<string, string> = {
  free: "Free Trial",
  basic: "Basic",
  premium: "Premium",
};

/**
 * Hook that wraps capability checks with upgrade toast notifications.
 * When serialKey is provided, checks that specific serial's plan capabilities.
 */
export function useCapabilityGuard(serialKey?: string) {
  const { can, limit, hasCapabilities, planType } = usePlanCapabilities(serialKey);
  const { toast } = useToast();
  const { t } = useTranslation();

  const planLabel = planType ? (PLAN_LABELS[planType] || planType) : undefined;

  const guard = useCallback(
    (key: string): boolean => {
      if (!hasCapabilities) return true;
      if (can(key)) return true;

      const planMsg = planLabel
        ? t("upgrade.planRestricted", "🔒 {{plan}} 플랜에서는 이 기능을 사용할 수 없습니다. 업그레이드가 필요합니다.", { plan: planLabel })
        : t("upgrade.featureLocked", "이 기능은 현재 플랜에서 사용할 수 없습니다. 웹사이트에서 플랜을 업그레이드해주세요.");

      toast({
        title: t("upgrade.required", "🔒 업그레이드 필요"),
        description: planMsg,
        variant: "destructive",
      });
      return false;
    },
    [can, hasCapabilities, toast, t, planLabel]
  );

  const guardLimit = useCallback(
    (key: string, current: number): boolean => {
      if (!hasCapabilities) return true;
      const max = limit(key);
      if (max === 0 || current < max) return true;

      toast({
        title: t("upgrade.limitReached", "🔒 제한 초과"),
        description: t("upgrade.maxDevicesReached", "최대 기기 수에 도달했습니다. 더 많은 기기를 추가하려면 플랜을 업그레이드해주세요."),
        variant: "destructive",
      });
      return false;
    },
    [limit, hasCapabilities, toast, t]
  );

  return { guard, guardLimit, can, limit, hasCapabilities };
}
