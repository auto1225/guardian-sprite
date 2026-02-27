import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { KeyRound } from "lucide-react";
import meercopCharacter from "@/assets/meercop-character.png";
import { supabase } from "@/integrations/supabase/client";

const SERIAL_STORAGE_KEY = "meercop_serial_key";
const SERIAL_DATA_KEY = "meercop_serial_data";

const Auth = () => {
  const { t } = useTranslation();
  const [serialParts, setSerialParts] = useState(["", "", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check if already authenticated via serial
  useEffect(() => {
    const savedSerial = localStorage.getItem(SERIAL_STORAGE_KEY);
    const savedData = localStorage.getItem(SERIAL_DATA_KEY);
    if (savedSerial && savedData) {
      try {
        const data = JSON.parse(savedData);
        // Check expiry
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
    // Auto-focus next input
    if (cleaned.length === 4 && index < 2) {
      const nextInput = document.getElementById(`serial-part-${index + 1}`);
      nextInput?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && serialParts[index] === "" && index > 0) {
      const prevInput = document.getElementById(`serial-part-${index - 1}`);
      prevInput?.focus();
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
    try {
      const { data, error } = await supabase.functions.invoke("validate-serial", {
        body: { serial_key: serialKey, device_type: "smartphone" },
      });

      if (error || !data?.success) {
        const msg = data?.error || error?.message || t("auth.unexpectedError");
        toast({ title: t("auth.serialValidationFailed"), description: msg, variant: "destructive" });
        return;
      }

      // Save serial session
      localStorage.setItem(SERIAL_STORAGE_KEY, serialKey);
      localStorage.setItem(SERIAL_DATA_KEY, JSON.stringify(data));

      toast({ title: t("auth.loginSuccess"), description: t("auth.loginSuccessDesc") });
      navigate("/");
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
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold text-base transition-colors disabled:opacity-50 active:scale-[0.98]"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mx-auto" />
              ) : t("auth.connectDevice")}
            </button>
          </form>

          {/* Info */}
          <div className="mt-6 p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-white/50 text-xs text-center leading-relaxed">
              {t("auth.serialInfo")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
