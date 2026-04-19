import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, User, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { websiteSupabase } from "@/lib/websiteAuth";
import meercopCharacter from "@/assets/meercop-character.png";

type AuthMode = "login" | "signup" | "emailSent";

const TERMS_URL = "https://meercop.com/terms";
const PRIVACY_URL = "https://meercop.com/privacy";

const Auth = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { effectiveUserId, loading, signIn, signUp } = useAuth();

  useEffect(() => {
    if (!loading && effectiveUserId) {
      navigate("/", { replace: true });
    }
  }, [loading, effectiveUserId, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({ title: t("auth.signupFailed"), description: t("auth.invalidCredentials"), variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: t("auth.signupFailed"), description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      toast({ title: t("auth.signupFailed"), description: t("auth.agreeRequired"), variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const { error, emailSent } = await signUp(email, password, name || undefined);
      if (error) {
        toast({ title: t("auth.signupFailed"), description: error.message, variant: "destructive" });
        return;
      }
      if (emailSent) {
        setMode("emailSent");
      } else {
        toast({ title: t("auth.signupSuccess"), description: t("auth.signupSuccessDesc") });
      }
    } catch {
      toast({ title: t("common.error"), description: t("auth.unexpectedError"), variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    setIsSubmitting(true);
    try {
      const { error } = await websiteSupabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      toast({ title: t("auth.resendSuccess") });
    } catch {
      toast({ title: t("auth.resendFailed"), variant: "destructive" });
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

  // Email verification sent screen
  if (mode === "emailSent") {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#4295E3' }}>
        <div className="flex flex-col items-center pt-14 pb-4">
          <p className="text-white font-black text-2xl tracking-wide drop-shadow-md">MeerCOP</p>
        </div>
        <div className="px-6 pt-4">
          <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-6 shadow-xl text-center">
            <Mail className="w-12 h-12 text-white mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">{t("auth.emailVerifyTitle")}</h2>
            <p className="text-white/70 text-sm leading-relaxed mb-2">
              <Trans
                i18nKey="auth.emailVerifyDesc"
                values={{ email }}
                components={{ 1: <span className="font-bold text-white" /> }}
              />
            </p>
            <p className="text-white/50 text-xs mb-6">{t("auth.emailVerifySpam")}</p>

            <button
              onClick={handleResendEmail}
              disabled={isSubmitting}
              className="text-white/70 text-sm hover:text-white transition-colors disabled:opacity-50"
            >
              {isSubmitting ? t("auth.resending") : t("auth.resendEmail")}
            </button>

            <div className="mt-4">
              <button
                onClick={() => { setMode("login"); setPassword(""); }}
                className="flex items-center gap-1 text-white/60 text-sm hover:text-white transition-colors mx-auto"
              >
                <ArrowLeft className="w-3 h-3" />
                {t("auth.backToLogin")}
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <img src={meercopCharacter} alt="MeerCOP" className="w-32 h-auto object-contain" />
        </div>
      </div>
    );
  }

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#4295E3' }}>
      {/* Header */}
      <div className="flex flex-col items-center pt-14 pb-4">
        <p className="text-white font-black text-2xl tracking-wide drop-shadow-md">MeerCOP</p>
        <p className="text-white/70 text-sm mt-1">{t("auth.subtitle")}</p>
      </div>

      {/* Form */}
      <div className="px-6 pt-4">
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-6 shadow-xl">
          <h2 className="text-xl font-bold text-white text-center mb-2 drop-shadow-sm">
            {isLogin ? t("auth.emailLogin") : t("auth.signupTitle")}
          </h2>
          <p className="text-white/60 text-xs text-center mb-6 whitespace-pre-line">
            {isLogin ? t("auth.emailLoginDesc") : t("auth.signupDesc")}
          </p>

          <form onSubmit={isLogin ? handleLogin : handleSignUp} className="space-y-4">
            {/* Name field (signup only) */}
            {!isLogin && (
              <div className="space-y-2">
                <label className="text-white/80 text-sm font-medium flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {t("auth.name")}
                </label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.namePlaceholder")}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-white/50"
                  autoComplete="name"
                  maxLength={100}
                />
              </div>
            )}

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
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold text-base transition-colors disabled:opacity-50 active:scale-[0.98] mt-2"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mx-auto" />
              ) : isLogin ? t("auth.login") : t("auth.signup")}
            </button>
          </form>

          {/* Toggle login/signup */}
          <button
            type="button"
            onClick={() => setMode(isLogin ? "signup" : "login")}
            className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold text-base transition-colors active:scale-[0.98] mt-4"
          >
            {isLogin ? t("auth.signup") : t("auth.backToLogin")}
          </button>
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
