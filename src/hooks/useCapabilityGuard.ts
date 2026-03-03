import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { usePlanCapabilities } from "@/hooks/usePlanCapabilities";
import { useCallback } from "react";

/**
 * Hook that wraps capability checks with upgrade toast notifications.
 * Returns a guard function: guard("capability_key") → true if allowed, false + toast if blocked.
 */
export function useCapabilityGuard() {
  const { can, limit, hasCapabilities } = usePlanCapabilities();
  const { toast } = useToast();
  const { t } = useTranslation();

  const guard = useCallback(
    (key: string): boolean => {
      // If no capabilities loaded (first load / offline without cache), allow everything
      if (!hasCapabilities) return true;
      if (can(key)) return true;

      toast({
        title: t("upgrade.required", "🔒 업그레이드 필요"),
        description: t("upgrade.featureLocked", "이 기능은 현재 플랜에서 사용할 수 없습니다. 웹사이트에서 플랜을 업그레이드해주세요."),
        variant: "destructive",
      });
      return false;
    },
    [can, hasCapabilities, toast, t]
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
