import { useState, useEffect, useCallback } from "react";
import { X, Check, Crown, Star, Sparkles, ArrowLeft, ArrowRight, Minus, Plus, Loader2, RefreshCw, PlusCircle, ShoppingCart, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { isRunningInNativeApp } from "@/lib/nativeBridge";
import { useToast } from "@/hooks/use-toast";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PurchaseMode = "upgrade" | "new";
type Step = "plans" | "mode" | "serial_select" | "plan_select" | "quantity" | "summary" | "processing" | "success";

const PLANS = [
  { type: "basic", name: "Basic Plan", price: 24.99, period: "6 months", months: 6 },
  { type: "premium", name: "Premium Plan", price: 39.99, period: "1 year", months: 12, featured: true },
];

const PLAN_ICONS: Record<string, typeof Crown> = { free: Sparkles, basic: Star, premium: Crown };
const PLAN_BADGE_CLS: Record<string, string> = {
  free: "text-emerald-300 bg-emerald-500/20",
  basic: "text-blue-300 bg-blue-500/20",
  premium: "text-amber-300 bg-amber-500/20",
};

const getRemainingDays = (expiresAt: string | null): number => {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
};

const PricingModal = ({ isOpen, onClose }: PricingModalProps) => {
  const { t } = useTranslation();
  const { serials, effectiveUserId, refreshSerials } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("plans");
  const [mode, setMode] = useState<PurchaseMode>("new");
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("basic");
  const [quantity, setQuantity] = useState(1);
  const [processing, setProcessing] = useState(false);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep("plans");
      setMode("new");
      setSelectedSerials([]);
      setSelectedPlan("basic");
      setQuantity(1);
      setProcessing(false);
    }
  }, [isOpen]);

  // Listen for IAP result from native
  useEffect(() => {
    if (!isOpen) return;

    const handleIAPResult = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log("[PricingModal] IAP result received:", detail);

      if (detail.success) {
        // Verify receipt on server
        try {
          const { websiteSupabase } = await import("@/lib/websiteAuth");
          const { data, error } = await websiteSupabase.functions.invoke("iap-payment", {
            body: {
              action: "verify_receipt",
              platform: detail.platform, // "apple" or "google"
              receipt_data: detail.receipt_data,
              product_id: detail.product_id,
              plan_type: selectedPlan,
              quantity: mode === "upgrade" ? selectedSerials.length : quantity,
              mode,
              serial_keys: mode === "upgrade" ? selectedSerials : [],
              user_id: effectiveUserId,
            },
          });

          if (error) throw new Error(error.message);
          if (data?.error) throw new Error(data.error);

          setStep("success");
          // Refresh serials
          if (refreshSerials) refreshSerials();
        } catch (err) {
          console.error("[PricingModal] Receipt verification failed:", err);
          toast({
            title: t("purchase.error"),
            description: err instanceof Error ? err.message : "Verification failed",
            variant: "destructive",
          });
          setProcessing(false);
        }
      } else {
        // Payment cancelled or failed
        setProcessing(false);
        if (detail.error) {
          toast({
            title: t("purchase.error"),
            description: detail.error,
            variant: "destructive",
          });
        }
      }
    };

    window.addEventListener("iap_result", handleIAPResult);
    return () => window.removeEventListener("iap_result", handleIAPResult);
  }, [isOpen, selectedPlan, mode, selectedSerials, quantity, effectiveUserId, toast, t, refreshSerials]);

  const activeSerials = serials.filter(s => s.status === "active" || s.status === "expired");
  const hasSerials = activeSerials.length > 0;

  const selectedPlanInfo = PLANS.find(p => p.type === selectedPlan) || PLANS[0];
  const upgradeCount = selectedSerials.length || 1;
  const totalAmount = mode === "upgrade" ? selectedPlanInfo.price * upgradeCount : selectedPlanInfo.price * quantity;
  const newDays = selectedPlanInfo.type === "basic" ? 180 : 365;

  const canSelectPlan = (planType: string): boolean => {
    if (mode !== "upgrade" || selectedSerials.length === 0) return true;
    const hierarchy: Record<string, number> = { free: 0, basic: 1, premium: 2 };
    const highestSelected = Math.max(
      ...selectedSerials.map(sk => {
        const s = serials.find(x => x.serial_key === sk);
        return hierarchy[s?.plan_type || "free"] ?? 0;
      })
    );
    return (hierarchy[planType] ?? 0) >= highestSelected;
  };

  const toggleSerial = (serialKey: string) => {
    setSelectedSerials(prev =>
      prev.includes(serialKey) ? prev.filter(k => k !== serialKey) : [...prev, serialKey]
    );
  };

  const handleBuyNow = () => {
    if (hasSerials) {
      setStep("mode");
    } else {
      setMode("new");
      setStep("quantity");
    }
  };

  const handlePay = useCallback(() => {
    setProcessing(true);
    setStep("processing");

    const isNative = isRunningInNativeApp();
    const productId = `meercop_${selectedPlan}_${selectedPlanInfo.months}m`;
    const itemQuantity = mode === "upgrade" ? upgradeCount : quantity;

    if (isNative && window.NativeApp?.purchaseProduct) {
      // Build detailed payment metadata for native app
      const metadata = JSON.stringify({
        // Product info
        product_id: productId,
        plan_type: selectedPlan,
        plan_name: selectedPlanInfo.name,
        duration_months: selectedPlanInfo.months,
        
        // Pricing
        unit_price: selectedPlanInfo.price,
        quantity: itemQuantity,
        total_amount: totalAmount,
        currency: "USD",
        
        // Purchase context
        mode, // "new" or "upgrade"
        serial_keys: mode === "upgrade" ? selectedSerials : [],
        
        // User
        user_id: effectiveUserId,
        
        // Server verification endpoint
        verify_url: `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/iap-payment`,
      });

      try {
        console.log("[PricingModal] → Native: purchaseProduct", productId, metadata);
        window.NativeApp.purchaseProduct(productId, metadata);
      } catch (err) {
        console.error("[PricingModal] Native purchaseProduct error:", err);
        setProcessing(false);
        setStep("summary");
        toast({ title: t("purchase.error"), description: "Failed to start payment", variant: "destructive" });
      }
    } else {
      // Fallback: redirect to web payment
      const url = `https://www.meercop.com/auth?redirect=/my-account?buy=${selectedPlan}`;
      if (window.NativeApp?.openExternalUrl) {
        window.NativeApp.openExternalUrl(url);
      } else {
        window.open(url, "_blank");
      }
      setProcessing(false);
      onClose();
    }
  }, [selectedPlan, selectedPlanInfo, mode, quantity, upgradeCount, selectedSerials, effectiveUserId, totalAmount, onClose, toast, t]);

  const handleClose = () => {
    if (processing) return;
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={handleClose} />
      <div className="fixed inset-0 z-[61] flex items-end sm:items-center justify-center">
        <div className="w-full max-w-md max-h-[90vh] bg-primary rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/15">
            <h2 className="text-lg font-bold text-primary-foreground flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              {step === "success" ? t("purchase.complete") : t("pricing.title")}
            </h2>
            {!processing && (
              <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-white/10 transition-colors">
                <X className="w-5 h-5 text-primary-foreground" />
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 alert-history-scroll">
            {/* Step: Plan overview (initial) */}
            {step === "plans" && (
              <div className="space-y-3">
                {PLANS.map((plan) => {
                  const Icon = PLAN_ICONS[plan.type] || Star;
                  const isSelected = selectedPlan === plan.type;
                  return (
                    <button
                      key={plan.type}
                      onClick={() => setSelectedPlan(plan.type)}
                      className={`w-full rounded-2xl p-4 text-left transition-all border ${
                        isSelected
                          ? "border-secondary bg-secondary/15 ring-1 ring-secondary/30"
                          : plan.featured
                            ? "border-amber-400/40 bg-amber-500/15"
                            : "border-white/20 bg-white/10 hover:bg-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? "bg-secondary border-secondary" : "border-white/30"
                          }`}>
                            {isSelected && <Check className="h-3 w-3 text-secondary-foreground" />}
                          </div>
                          <Icon className={`w-5 h-5 ${plan.featured ? "text-amber-400" : "text-blue-400"}`} />
                          <span className="font-bold text-primary-foreground">{plan.name}</span>
                        </div>
                        <span className="text-xl font-bold text-primary-foreground">${plan.price.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-white/60 ml-12">{plan.period}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step: Mode (upgrade vs new) */}
            {step === "mode" && (
              <div className="space-y-3">
                <button
                  onClick={() => { setMode("upgrade"); setStep("serial_select"); }}
                  className="w-full border border-white/20 rounded-2xl p-4 text-left hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-secondary shrink-0" />
                    <div>
                      <p className="font-bold text-primary-foreground">{t("purchase.upgradeExtend")}</p>
                      <p className="text-xs text-white/60">{t("purchase.upgradeDesc")}</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => { setMode("new"); setStep("quantity"); }}
                  className="w-full border border-white/20 rounded-2xl p-4 text-left hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <PlusCircle className="w-5 h-5 text-secondary shrink-0" />
                    <div>
                      <p className="font-bold text-primary-foreground">{t("purchase.buyNew")}</p>
                      <p className="text-xs text-white/60">{t("purchase.buyNewDesc")}</p>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Step: Serial selection */}
            {step === "serial_select" && (
              <div className="space-y-2">
                {activeSerials.length > 1 && (
                  <button
                    onClick={() => {
                      if (selectedSerials.length === activeSerials.length) setSelectedSerials([]);
                      else setSelectedSerials(activeSerials.map(s => s.serial_key));
                    }}
                    className="text-xs text-secondary hover:underline mb-1"
                  >
                    {selectedSerials.length === activeSerials.length ? t("purchase.deselectAll") : t("purchase.selectAll")}
                  </button>
                )}
                <div className="space-y-2 max-h-60 overflow-y-auto alert-history-scroll">
                  {activeSerials.map((s) => {
                    const remaining = getRemainingDays(s.expires_at);
                    const isExpired = remaining <= 0;
                    const isSelected = selectedSerials.includes(s.serial_key);
                    const Icon = PLAN_ICONS[s.plan_type] || Sparkles;
                    return (
                      <button
                        key={s.serial_key}
                        onClick={() => toggleSerial(s.serial_key)}
                        className={`w-full border rounded-2xl p-3 text-left transition-all ${
                          isSelected ? "border-secondary bg-secondary/10" : "border-white/20 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                              isSelected ? "bg-secondary border-secondary" : "border-white/30"
                            }`}>
                              {isSelected && <Check className="h-3 w-3 text-secondary-foreground" />}
                            </div>
                            <span className="font-mono text-xs font-bold text-white/90">{s.serial_key}</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            isExpired ? "bg-destructive/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                          }`}>
                            {isExpired ? t("purchase.expired") : `${remaining}${t("plan.days")}`}
                          </span>
                        </div>
                        <p className="text-xs text-white/50 mt-1 ml-7 flex items-center gap-1">
                          <Icon className="h-3 w-3" />{t(`plan.${s.plan_type}`)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step: Plan selection (for upgrade) */}
            {step === "plan_select" && (
              <div className="space-y-3">
                {PLANS.map((plan) => {
                  const disabled = !canSelectPlan(plan.type);
                  return (
                    <button
                      key={plan.type}
                      disabled={disabled}
                      onClick={() => { setSelectedPlan(plan.type); setStep("summary"); }}
                      className={`w-full border rounded-2xl p-4 text-left transition-all ${
                        disabled ? "opacity-40 cursor-not-allowed border-white/10" :
                        plan.featured ? "border-amber-400/40 bg-amber-500/15" : "border-white/20 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-primary-foreground">{plan.name}</span>
                        <span className="text-xl font-bold text-primary-foreground">${plan.price.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-white/60">{plan.period}</p>
                      {disabled && <p className="text-xs text-red-400 mt-1">{t("purchase.cannotDowngrade")}</p>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step: Quantity */}
            {step === "quantity" && (
              <div className="flex flex-col items-center gap-4 py-6">
                <p className="text-sm text-white/60">{t("purchase.howMany")}</p>
                <div className="flex items-center gap-6">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 disabled:opacity-30 transition-colors"
                  >
                    <Minus className="w-4 h-4 text-primary-foreground" />
                  </button>
                  <span className="text-4xl font-bold text-primary-foreground w-16 text-center">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-primary-foreground" />
                  </button>
                </div>
                <p className="text-lg font-bold text-primary-foreground">
                  ${(selectedPlanInfo.price * quantity).toFixed(2)}
                  <span className="text-sm text-white/50 font-normal ml-1">{t("purchase.total")}</span>
                </p>
              </div>
            )}

            {/* Step: Summary */}
            {step === "summary" && (
              <div className="space-y-3 bg-white/5 rounded-2xl p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">{t("purchase.type")}</span>
                  <span className="font-bold text-primary-foreground">
                    {mode === "upgrade" ? t("purchase.upgradeExtend") : t("purchase.newSerial")}
                  </span>
                </div>
                {mode === "upgrade" && selectedSerials.length > 0 && (
                  <div className="text-sm">
                    <span className="text-white/60">{t("purchase.serials")} ({selectedSerials.length})</span>
                    <div className="mt-1 space-y-1">
                      {selectedSerials.map(sk => {
                        const s = serials.find(x => x.serial_key === sk);
                        const remaining = getRemainingDays(s?.expires_at || null);
                        return (
                          <div key={sk} className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-2 py-1.5">
                            <span className="font-mono text-white/80">{sk}</span>
                            <span className="text-white/50">{remaining}d → {remaining + newDays}d</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">{t("purchase.planLabel")}</span>
                  <span className="font-bold text-primary-foreground">{selectedPlanInfo.name}</span>
                </div>
                {mode === "new" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">{t("purchase.quantity")}</span>
                    <span className="font-bold text-primary-foreground">×{quantity}</span>
                  </div>
                )}
                {mode === "upgrade" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">{t("purchase.serials")}</span>
                    <span className="font-bold text-primary-foreground">×{upgradeCount} × ${selectedPlanInfo.price.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-white/15 pt-2">
                  <span className="text-primary-foreground">{t("purchase.total")}</span>
                  <span className="text-secondary text-lg">${totalAmount.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Step: Processing */}
            {step === "processing" && (
              <div className="flex flex-col items-center gap-4 py-10">
                <Loader2 className="w-10 h-10 text-secondary animate-spin" />
                <p className="text-sm text-white/60">{t("purchase.processing")}</p>
              </div>
            )}

            {/* Step: Success */}
            {step === "success" && (
              <div className="flex flex-col items-center gap-4 py-10">
                <CheckCircle className="w-14 h-14 text-emerald-400" />
                <p className="text-lg font-bold text-primary-foreground">{t("purchase.successTitle")}</p>
                <p className="text-sm text-white/60 text-center">{t("purchase.successDesc")}</p>
              </div>
            )}
          </div>

          {/* Footer navigation */}
          <div className="px-5 py-4 border-t border-white/15">
            <div className="flex gap-3">
              {/* Back button */}
              {["mode", "serial_select", "plan_select", "quantity", "summary"].includes(step) && (
                <button
                  onClick={() => {
                    if (step === "mode") setStep("plans");
                    else if (step === "serial_select") setStep("mode");
                    else if (step === "plan_select") setStep("serial_select");
                    else if (step === "quantity") setStep(hasSerials ? "mode" : "plans");
                    else if (step === "summary") setStep(mode === "upgrade" ? "plan_select" : "quantity");
                  }}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-white/10 text-primary-foreground hover:bg-white/15 transition-colors flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />{t("purchase.back")}
                </button>
              )}

              {/* Forward / action buttons */}
              {step === "plans" && (
                <button
                  onClick={handleBuyNow}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {t("purchase.buyNow")}
                </button>
              )}

              {step === "serial_select" && (
                <button
                  onClick={() => setStep("plan_select")}
                  disabled={selectedSerials.length === 0}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                >
                  {t("purchase.next")} ({selectedSerials.length})<ArrowRight className="w-4 h-4" />
                </button>
              )}

              {step === "quantity" && (
                <button
                  onClick={() => setStep("summary")}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors flex items-center justify-center gap-1"
                >
                  {t("purchase.reviewOrder")}<ArrowRight className="w-4 h-4" />
                </button>
              )}

              {step === "summary" && (
                <button
                  onClick={handlePay}
                  disabled={processing}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-lg shadow-amber-500/20 transition-colors flex items-center justify-center gap-1"
                >
                  {processing ? <><Loader2 className="w-4 h-4 animate-spin" />{t("purchase.processing")}</> : t("purchase.pay")}
                </button>
              )}

              {step === "success" && (
                <button
                  onClick={handleClose}
                  className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {t("purchase.done")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PricingModal;
