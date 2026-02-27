import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Crown, Star, Sparkles, CalendarDays } from "lucide-react";
import meercopCharacter from "@/assets/meercop-character.png";
import { supabase } from "@/integrations/supabase/client";

const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

interface PlanInfo {
  plan_type: string;
  expires_at: string | null;
  remaining_days: number | null;
}

const PLAN_CONFIG: Record<string, { icon: typeof Crown; label: string; colorClass: string; bgClass: string }> = {
  free: { icon: Sparkles, label: "plan.free", colorClass: "text-emerald-300", bgClass: "bg-emerald-500/20 border-emerald-400/30" },
  basic: { icon: Star, label: "plan.basic", colorClass: "text-blue-300", bgClass: "bg-blue-500/20 border-blue-400/30" },
  premium: { icon: Crown, label: "plan.premium", colorClass: "text-amber-300", bgClass: "bg-amber-500/20 border-amber-400/30" },
};

const PlanInfoCard = ({ planInfo }: { planInfo: PlanInfo }) => {
  const { t } = useTranslation();
  const config = PLAN_CONFIG[planInfo.plan_type] || PLAN_CONFIG.free;
  const Icon = config.icon;

  return (
    <div className={`mt-5 p-4 rounded-2xl border ${config.bgClass} backdrop-blur-md`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl bg-white/10`}>
          <Icon className={`w-5 h-5 ${config.colorClass}`} />
        </div>
        <div>
          <p className={`font-bold text-sm ${config.colorClass}`}>{t(config.label)}</p>
          <p className="text-white/50 text-xs">{t("plan.currentPlan")}</p>
        </div>
      </div>

      {planInfo.remaining_days !== null && (
        <div className="flex items-center gap-2 mt-2 p-2.5 rounded-xl bg-white/5">
          <CalendarDays className="w-4 h-4 text-white/50" />
          <span className="text-white/70 text-xs">{t("plan.remainingDays")}</span>
          <span className={`font-bold text-sm ml-auto ${
            planInfo.remaining_days <= 3 ? "text-red-400" : 
            planInfo.remaining_days <= 7 ? "text-amber-400" : "text-white"
          }`}>
            {planInfo.remaining_days}{t("plan.days")}
          </span>
        </div>
      )}

      {planInfo.expires_at && (
        <p className="text-white/30 text-[10px] mt-2 text-right">
          {t("plan.expiresAt")}: {new Date(planInfo.expires_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
};

const Auth = () => {
  const { t } = useTranslation();
  const [serialParts, setSerialParts] = useState(["", "", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const savedSerial = localStorage.getItem(SERIAL_STORAGE_KEY);
    const savedData = localStorage.getItem(SERIAL_DATA_KEY);
    if (savedSerial && savedData) {
      try {
        const data = JSON.parse(savedData);
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          localStorage.removeItem(SERIAL_STORAGE_KEY);
          localStorage.removeItem(SERIAL_DATA_KEY);
          toast({ title: t("auth.serialExpired"), description: t("auth.serialExpiredDesc"), variant: "destructive" });
          return;
        }
        navigate("/");
      } catch {
        localStorage.removeItem(SERIAL_STORAGE_KEY);
        localStorage.removeItem(SERIAL_DATA_KEY);
      }
    }
  }, [navigate, toast, t]);

  const handlePartChange = useCallback((index: number, value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    setSerialParts(prev => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    if (cleaned.length === 4 && index < 2) {
      document.getElementById(`serial-part-${index + 1}`)?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && serialParts[index] === "" && index > 0) {
      document.getElementById(`serial-part-${index - 1}`)?.focus();
    }
  }, [serialParts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const serialKey = serialParts.join("-");

    if (serialParts.some(p => p.length !== 4)) {
      toast({ title: t("auth.serialError"), description: t("auth.enterFullSerial"), variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setPlanInfo(null);
    try {
      const { data, error } = await supabase.functions.invoke("validate-serial", {
        body: { serial_key: serialKey, device_type: "smartphone" },
      });

      if (error || !data?.success) {
        const msg = data?.error || error?.message || t("auth.unexpectedError");
        toast({ title: t("auth.serialValidationFailed"), description: msg, variant: "destructive" });
        return;
      }

      // Show plan info before navigating
      setPlanInfo({
        plan_type: data.plan_type || "free",
        expires_at: data.expires_at,
        remaining_days: data.remaining_days,
      });

      // Save serial session
      localStorage.setItem(SERIAL_STORAGE_KEY, serialKey);
      localStorage.setItem(SERIAL_DATA_KEY, JSON.stringify(data));

      toast({ title: t("auth.loginSuccess"), description: t("auth.loginSuccessDesc") });

      // Navigate after showing plan info briefly
      setTimeout(() => navigate("/"), 2500);
    } catch {
      toast({ title: t("common.error"), description: t("auth.unexpectedError"), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col">
      {/* Header */}
      <div className="flex flex-col items-center pt-14 pb-4">
        <img src={meercopCharacter} alt="MeerCOP" className="w-28 h-auto object-contain mb-2" />
        <p className="text-white font-black text-2xl tracking-wide drop-shadow-md">MeerCOP</p>
        <p className="text-white/70 text-sm mt-1">{t("auth.subtitle")}</p>
      </div>

      {/* Serial Login Form */}
      <div className="flex-1 px-6 pb-8 pt-4">
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-6 shadow-xl">
          <h2 className="text-xl font-bold text-white text-center mb-2 drop-shadow-sm">
            {t("auth.serialLogin")}
          </h2>
          <p className="text-white/60 text-xs text-center mb-6">
            {t("auth.serialLoginDesc")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-white/80 text-sm font-medium flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                {t("auth.serialNumber")}
              </label>
              <div className="flex items-center gap-2 justify-center">
                {serialParts.map((part, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      id={`serial-part-${i}`}
                      type="text"
                      inputMode="text"
                      maxLength={4}
                      value={part}
                      onChange={(e) => handlePartChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      placeholder="XXXX"
                      className="w-[72px] text-center text-lg font-mono tracking-widest bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-white/50"
                    />
                    {i < 2 && <span className="text-white/40 text-xl font-bold">-</span>}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !!planInfo}
              className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold text-base transition-colors disabled:opacity-50 active:scale-[0.98]"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mx-auto" />
              ) : t("auth.connectDevice")}
            </button>
          </form>

          {/* Plan Info Card - shown after successful validation */}
          {planInfo && <PlanInfoCard planInfo={planInfo} />}

          {/* Info */}
          {!planInfo && (
            <div className="mt-6 p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-white/50 text-xs text-center leading-relaxed">
                {t("auth.serialInfo")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
