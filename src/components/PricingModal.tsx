import { useState } from "react";
import { X, Check, Crown, Star, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isRunningInNativeApp } from "@/lib/nativeBridge";

interface PlanFeature {
  key: string;
  included: boolean[];
}

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PLAN_ICONS = [Sparkles, Star, Crown] as const;
const PLAN_COLORS = [
  "border-emerald-400/30 bg-emerald-500/10",
  "border-blue-400/30 bg-blue-500/10",
  "border-amber-400/40 bg-amber-500/15 ring-1 ring-amber-400/20",
] as const;
const PLAN_ICON_COLORS = ["text-emerald-400", "text-blue-400", "text-amber-400"] as const;

const PricingModal = ({ isOpen, onClose }: PricingModalProps) => {
  const { t } = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState(1);

  if (!isOpen) return null;

  const plans = [
    { name: t("plan.free"), price: "0", period: t("pricing.freePeriod"), key: "free" },
    { name: t("plan.basic"), price: "24.90", period: t("pricing.basicPeriod"), key: "basic" },
    { name: t("plan.premium"), price: "39.90", period: t("pricing.premiumPeriod"), key: "premium" },
  ];

  const features: PlanFeature[] = [
    { key: "pricing.feat.detectAlert", included: [true, true, true] },
    { key: "pricing.feat.streaming", included: [true, true, true] },
    { key: "pricing.feat.multiDevice", included: [true, true, true] },
    { key: "pricing.feat.realtimeView", included: [false, true, true] },
    { key: "pricing.feat.stealth", included: [false, false, true] },
    { key: "pricing.feat.gps", included: [true, true, true] },
    { key: "pricing.feat.cameraMotion", included: [false, true, true] },
    { key: "pricing.feat.sound", included: [false, true, true] },
    { key: "pricing.feat.lid", included: [false, true, true] },
    { key: "pricing.feat.keyboard", included: [true, true, true] },
    { key: "pricing.feat.mouse", included: [false, true, true] },
    { key: "pricing.feat.usb", included: [false, true, true] },
    { key: "pricing.feat.power", included: [false, true, true] },
    { key: "pricing.feat.history", included: [true, true, true] },
  ];

  const handlePurchase = (planIndex: number) => {
    if (planIndex === 0) return; // Free plan — no purchase

    const isNative = isRunningInNativeApp();
    if (isNative && window.NativeApp?.openExternalUrl) {
      window.NativeApp.openExternalUrl(`https://www.meercop.com/auth?redirect=/my-account?buy=${plans[planIndex].key}`);
    } else {
      window.open(`https://www.meercop.com/auth?redirect=/my-account?buy=${plans[planIndex].key}`, "_blank");
    }
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[61] flex items-end sm:items-center justify-center">
        <div className="w-full max-w-md max-h-[90vh] bg-primary rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/15">
            <h2 className="text-lg font-bold text-primary-foreground">{t("pricing.title")}</h2>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 transition-colors">
              <X className="w-5 h-5 text-primary-foreground" />
            </button>
          </div>

          {/* Plan selector tabs */}
          <div className="flex gap-2 px-5 py-3">
            {plans.map((plan, i) => {
              const Icon = PLAN_ICONS[i];
              const isActive = selectedPlan === i;
              return (
                <button
                  key={plan.key}
                  onClick={() => setSelectedPlan(i)}
                  className={`flex-1 py-2.5 px-2 rounded-xl text-center transition-all duration-200 border ${
                    isActive
                      ? `${PLAN_COLORS[i]} border-white/30`
                      : "border-transparent bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${isActive ? PLAN_ICON_COLORS[i] : "text-white/40"}`} />
                  <p className={`text-[11px] font-bold ${isActive ? "text-primary-foreground" : "text-white/50"}`}>
                    {plan.name}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Selected plan detail */}
          <div className="flex-1 overflow-y-auto px-5 pb-4 alert-history-scroll">
            <div className={`rounded-2xl p-4 border ${PLAN_COLORS[selectedPlan]}`}>
              {/* Price */}
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-white/60 text-sm">$</span>
                <span className="text-3xl font-bold text-primary-foreground">{plans[selectedPlan].price}</span>
                <span className="text-white/60 text-sm">{plans[selectedPlan].period}</span>
              </div>

              {/* Features */}
              <ul className="space-y-2.5">
                {features.map((feat) => {
                  const included = feat.included[selectedPlan];
                  return (
                    <li key={feat.key} className="flex items-center gap-2.5">
                      {included ? (
                        <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 shrink-0 text-white/25" />
                      )}
                      <span className={`text-sm ${included ? "text-primary-foreground" : "text-white/30"}`}>
                        {t(feat.key)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* CTA */}
          <div className="px-5 py-4 border-t border-white/15">
            <button
              onClick={() => handlePurchase(selectedPlan)}
              disabled={selectedPlan === 0}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
                selectedPlan === 0
                  ? "bg-white/10 text-white/40 cursor-not-allowed"
                  : selectedPlan === 2
                    ? "bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-lg shadow-amber-500/20"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {selectedPlan === 0 ? t("pricing.currentFree") : t("pricing.subscribe")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PricingModal;
