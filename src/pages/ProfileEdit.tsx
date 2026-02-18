import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, User, Mail, Lock, Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const ProfileEdit = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.display_name) setDisplayName(data.display_name);
      else setDisplayName(user.email?.split("@")[0] || "");
    };
    fetchProfile();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName })
        .eq("user_id", user.id);
      if (error) throw error;
      toast({ title: t("profile.saved"), description: t("profile.profileUpdated") });
    } catch {
      toast({ title: t("common.error"), description: t("profile.saveFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast({ title: t("common.error"), description: t("profile.passwordTooShort"), variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t("common.error"), description: t("profile.passwordMismatch"), variant: "destructive" });
      return;
    }
    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: t("profile.passwordChanged"), description: t("profile.passwordChangedDesc") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast({ title: t("common.error"), description: t("profile.passwordChangeFailed"), variant: "destructive" });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(180deg, hsla(200, 70%, 50%, 1) 0%, hsla(200, 65%, 38%, 1) 100%)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/20">
        <button onClick={() => navigate(-1)} className="text-white hover:text-white/80 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white font-bold text-lg">{t("profile.title")}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Profile Section */}
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md border border-white/25 flex items-center justify-center">
            <User className="w-10 h-10 text-white" />
          </div>
          <p className="text-white/70 text-sm">{user?.email}</p>
        </div>

        {/* Display Name */}
        <div className="rounded-2xl p-4 border border-white/25 space-y-3" style={{ background: "hsla(0,0%,100%,0.15)" }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-white/70" />
            <span className="text-white font-semibold text-sm">{t("profile.nickname")}</span>
          </div>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
            placeholder={t("profile.nicknamePlaceholder")}
          />
          <Button
            onClick={handleSaveProfile}
            disabled={loading}
            className="w-full bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold rounded-xl"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? t("profile.saving") : t("profile.saveNickname")}
          </Button>
        </div>

        {/* Email (read-only) */}
        <div className="rounded-2xl p-4 border border-white/25" style={{ background: "hsla(0,0%,100%,0.15)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-white/70" />
            <span className="text-white font-semibold text-sm">{t("profile.email")}</span>
          </div>
          <p className="text-white/80 text-sm mt-2">{user?.email || "-"}</p>
          <p className="text-white/50 text-xs mt-1">{t("profile.emailReadonly")}</p>
        </div>

        {/* Password Change */}
        <div className="rounded-2xl p-4 border border-white/25 space-y-3" style={{ background: "hsla(0,0%,100%,0.15)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-white/70" />
            <span className="text-white font-semibold text-sm">{t("profile.changePassword")}</span>
          </div>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
            placeholder={t("profile.newPassword")}
          />
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
            placeholder={t("profile.confirmNewPassword")}
          />
          <Button
            onClick={handleChangePassword}
            disabled={passwordLoading || !newPassword || !confirmPassword}
            className="w-full bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white font-bold rounded-xl"
          >
            <Lock className="w-4 h-4 mr-2" />
            {passwordLoading ? t("profile.changing") : t("profile.changePassword")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProfileEdit;
