import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import meercopCharacter from "@/assets/meercop-character.png";

const Auth = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { effectiveUserId, loading, signIn } = useAuth();

  useEffect(() => {
    if (!loading && effectiveUserId) {
      navigate("/", { replace: true });
    }
  }, [loading, effectiveUserId, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({ title: t("auth.loginFailed"), description: t("auth.invalidCredentials"), variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: t("auth.loginFailed"), description: t("auth.invalidCredentials"), variant: "destructive" });
        return;
      }
      toast({ title: t("auth.loginSuccess"), description: t("auth.loginSuccessDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("auth.unexpectedError"), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#4295E3' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#4295E3' }}>
      {/* Header - text only */}
      <div className="flex flex-col items-center pt-14 pb-4">
        <p className="text-white font-black text-2xl tracking-wide drop-shadow-md">MeerCOP</p>
        <p className="text-white/70 text-sm mt-1">{t("auth.subtitle")}</p>
      </div>

      {/* Login Form */}
      <div className="px-6 pt-4">
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-6 shadow-xl">
          <h2 className="text-xl font-bold text-white text-center mb-2 drop-shadow-sm">
            {t("auth.emailLogin")}
          </h2>
          <p className="text-white/60 text-xs text-center mb-6">
            {t("auth.emailLoginDesc")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-white/80 text-sm font-medium flex items-center gap-2">
                <Mail className="w-4 h-4" />
                {t("auth.email")}
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-white/50"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label className="text-white/80 text-sm font-medium flex items-center gap-2">
                <Lock className="w-4 h-4" />
                {t("auth.password")}
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-white/50"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold text-base transition-colors disabled:opacity-50 active:scale-[0.98] mt-2"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mx-auto" />
              ) : t("auth.login")}
            </button>
          </form>

          {/* Info */}
          <div className="mt-6 p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-white/50 text-xs text-center leading-relaxed">
              {t("auth.loginInfo")}
            </p>
          </div>
        </div>
      </div>

      {/* Character at bottom */}
      <div className="flex-1 flex items-center justify-center">
        <img src={meercopCharacter} alt="MeerCOP" className="w-32 h-auto object-contain" />
      </div>
    </div>
  );
};

export default Auth;
