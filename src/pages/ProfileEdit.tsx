import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, User, Mail, Lock, Save, Camera } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { websiteSupabase } from "@/lib/websiteAuth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useTranslation } from "react-i18next";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const ProfileEdit = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await websiteSupabase
        .from("public_profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.display_name) setDisplayName(data.display_name);
      else setDisplayName(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "");
      if (data?.avatar_url) setAvatarUrl(data.avatar_url);
    };
    fetchProfile();
  }, [user]);

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate
    if (!file.type.startsWith("image/")) {
      toast({ title: t("common.error"), description: t("profile.invalidImageType"), variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: t("common.error"), description: t("profile.imageTooLarge"), variant: "destructive" });
      return;
    }

    setAvatarLoading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/avatar.${ext}`;

      // Upload to website storage
      const { error: uploadError } = await websiteSupabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = websiteSupabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      // Update public_profiles table
      const { error: updateError } = await websiteSupabase
        .from("public_profiles")
        .update({ avatar_url: publicUrl })
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      toast({ title: t("profile.avatarUpdated") });
    } catch (err) {
      console.error("[ProfileEdit] Avatar upload failed:", err);
      toast({ title: t("common.error"), description: t("profile.avatarUploadFailed"), variant: "destructive" });
    } finally {
      setAvatarLoading(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await websiteSupabase
        .from("public_profiles")
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
      const { error } = await websiteSupabase.auth.updateUser({ password: newPassword });
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

  const initials = (user?.email?.charAt(0) || "U").toUpperCase();

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
        {/* Avatar Section */}
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="relative">
            <Avatar className="w-20 h-20 border-2 border-white/30">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt="avatar" />
              ) : null}
              <AvatarFallback className="bg-white/20 text-white text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-white/30 backdrop-blur-md border border-white/40 flex items-center justify-center hover:bg-white/50 transition-colors disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5 text-white" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarSelect}
            />
          </div>
          {avatarLoading && (
            <span className="text-white/60 text-xs animate-pulse">{t("profile.uploading")}</span>
          )}
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
