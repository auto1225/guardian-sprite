import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Mail, Lock, AlertTriangle } from "lucide-react";
import { websiteSupabase } from "@/lib/websiteAuth";
import meercopCharacter from "@/assets/meercop-character.png";

const DeleteAccount = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit =
    email.trim() !== "" &&
    password.trim() !== "" &&
    confirmText === "DELETE" &&
    !isSubmitting;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setResult(null);
    setErrorMsg("");

    try {
      // 1. Sign in to verify credentials
      const { data: signInData, error: signInError } =
        await websiteSupabase.auth.signInWithPassword({ email, password });

      if (signInError || !signInData.session) {
        setResult("error");
        setErrorMsg(t("deleteAccount.invalidCredentials"));
        setIsSubmitting(false);
        return;
      }

      // 2. Call delete-account edge function on website supabase
      const res = await fetch(
        `https://peqgmuicrorjvvburqly.supabase.co/functions/v1/delete-account`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey:
              "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlcWdtdWljcm9yanZ2YnVycWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDA1NzQsImV4cCI6MjA4NzUxNjU3NH0.e5HYG3dSMqhm4ahT-en-nNX2mD95KM_TdKIlfuzdMc4",
            Authorization: `Bearer ${signInData.session.access_token}`,
          },
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setResult("error");
        setErrorMsg(body?.error || t("deleteAccount.failed"));
        setIsSubmitting(false);
        return;
      }

      // 3. Sign out locally
      await websiteSupabase.auth.signOut();
      setResult("success");
    } catch {
      setResult("error");
      setErrorMsg(t("deleteAccount.failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (result === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col items-center justify-center px-6">
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-8 shadow-xl max-w-sm w-full text-center">
          <p className="text-white text-xl font-bold mb-2">
            {t("deleteAccount.successTitle")}
          </p>
          <p className="text-white/70 text-sm">
            {t("deleteAccount.successDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col">
      {/* Header */}
      <div className="flex flex-col items-center pt-14 pb-4">
        <img
          src={meercopCharacter}
          alt="MeerCOP"
          className="w-28 h-auto object-contain mb-2"
        />
        <p className="text-white font-black text-2xl tracking-wide drop-shadow-md">
          MeerCOP
        </p>
        <p className="text-white/70 text-sm mt-1">
          {t("deleteAccount.subtitle")}
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 pb-8 pt-4">
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-3xl p-6 shadow-xl max-w-sm mx-auto">
          <div className="flex items-center justify-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="text-xl font-bold text-white drop-shadow-sm">
              {t("deleteAccount.title")}
            </h2>
          </div>
          <p className="text-white/60 text-xs text-center mb-6">
            {t("deleteAccount.warning")}
          </p>

          <form onSubmit={handleDelete} className="space-y-4">
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

            <div className="space-y-2">
              <label className="text-white/80 text-sm font-medium">
                {t("deleteAccount.confirmLabel")}
              </label>
              <Input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-white/50 font-mono tracking-widest"
              />
            </div>

            {result === "error" && (
              <p className="text-red-300 text-xs text-center">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3.5 rounded-xl bg-red-500/80 backdrop-blur-md border border-red-400/30 hover:bg-red-500 text-white font-bold text-base transition-colors disabled:opacity-40 active:scale-[0.98] mt-2"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mx-auto" />
              ) : (
                t("deleteAccount.deleteButton")
              )}
            </button>
          </form>

          <div className="mt-6 p-3 rounded-xl bg-red-500/10 border border-red-400/20">
            <p className="text-white/50 text-xs text-center leading-relaxed">
              {t("deleteAccount.notice")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteAccount;
