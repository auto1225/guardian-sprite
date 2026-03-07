import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, User, LogOut, HelpCircle, UserCog, Globe, Crown, Star, Sparkles, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/dynamicTranslation";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import logoImage from "@/assets/meercop-character.png";

const ITEMS_PER_PAGE = 5;

const PLAN_BADGE: Record<string, { icon: typeof Crown; cls: string }> = {
  free: { icon: Sparkles, cls: "text-emerald-300 bg-emerald-500/20" },
  basic: { icon: Star, cls: "text-blue-300 bg-blue-500/20" },
  premium: { icon: Crown, cls: "text-amber-300 bg-amber-500/20" },
};

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onHelpClick?: () => void;
  onLegalClick?: () => void;
}

const SideMenu = ({ isOpen, onClose, onHelpClick, onLegalClick }: SideMenuProps) => {
  const { t, i18n } = useTranslation();
  const { user, serials, signOut, effectiveUserId } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [serialPage, setSerialPage] = useState(1);
  const [showLangs, setShowLangs] = useState(false);
  const [deviceNameMap, setDeviceNameMap] = useState<Record<string, string>>({});
  const [isUpdating, setIsUpdating] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const handleCheckUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      // 1) DB에서 최신 버전 조회
      const { data } = await supabase.functions.invoke("check-app-version");
      const latestVersion = data?.latest_version;
      const currentVersion = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "";

      // 2) 비교
      if (!latestVersion || latestVersion === currentVersion) {
        toast({
          title: t("sideMenu.updateUpToDate"),
          description: `${t("sideMenu.currentVersion")}: ${currentVersion}`,
        });
        setIsUpdating(false);
        return;
      }

      // 3) 업데이트 필요 → 확인 후 새로고침
      toast({
        title: t("sideMenu.updateAvailable"),
        description: `${latestVersion}`,
      });

      // 잠시 후 자동 새로고침
      setTimeout(() => {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistration().then((reg) => {
            if (reg) {
              reg.update().then(() => {
                if (reg.waiting) {
                  reg.waiting.postMessage({ type: "SKIP_WAITING" });
                } else {
                  window.location.reload();
                }
              });
            } else {
              window.location.reload();
            }
          });
        } else {
          window.location.reload();
        }
      }, 2000);
    } catch {
      toast({
        title: t("sideMenu.updateCheckFailed"),
        variant: "destructive",
      });
      setIsUpdating(false);
    }
  }, [toast, t]);

  // Fetch avatar + device names
  useEffect(() => {
    if (!isOpen || !effectiveUserId) return;

    // Fetch avatar
    const fetchAvatar = async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("user_id", effectiveUserId)
          .maybeSingle();
        if (data?.avatar_url) setAvatarUrl(data.avatar_url);
      } catch (err) {
        console.warn("[SideMenu] Failed to fetch avatar:", err);
      }
    };
    fetchAvatar();

    // Fetch device names
    const fetchDeviceNames = async () => {
      try {
        const { data } = await supabase.functions.invoke("get-devices", {
          body: { user_id: effectiveUserId },
        });
        const devices = data?.devices || [];
        const idToName: Record<string, string> = {};
        for (const d of devices) {
          idToName[d.id] = d.name;
        }
        const { data: licenseData } = await supabase
          .from("licenses")
          .select("serial_key, device_id")
          .eq("user_id", effectiveUserId);
        const map: Record<string, string> = {};
        if (licenseData) {
          for (const lic of licenseData) {
            if (lic.device_id && idToName[lic.device_id]) {
              map[lic.serial_key] = idToName[lic.device_id];
            }
          }
        }
        setDeviceNameMap(map);
      } catch (err) {
        console.warn("[SideMenu] Failed to fetch device names:", err);
      }
    };
    fetchDeviceNames();
  }, [isOpen, effectiveUserId]);

  const totalPages = Math.ceil(serials.length / ITEMS_PER_PAGE);
  const pageSerials = serials.slice((serialPage - 1) * ITEMS_PER_PAGE, serialPage * ITEMS_PER_PAGE);

  const handleSignOut = async () => {
    await signOut();
    toast({ title: t("sideMenu.loggedOut"), description: t("sideMenu.loggedOutDesc") });
    onClose();
    navigate("/auth");
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Menu Panel */}
      <div className="fixed left-0 top-0 h-full w-[70%] max-w-[280px] bg-primary z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/20">
          <div className="flex items-center gap-2">
            <img src={logoImage} alt="MeerCOP" className="w-10 h-10 object-contain" />
            <div>
              <p className="text-lg font-extrabold text-primary-foreground">MeerCOP</p>
              <p className="text-xs text-white/70">{typeof __BUILD_TIME__ !== 'undefined' ? `${t('sideMenu.updatedAt')} ${__BUILD_TIME__}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2" aria-label={t("common.close")}>
            <ChevronLeft className="w-5 h-5 text-primary-foreground" />
          </button>
        </div>

        {/* User Info */}
        <div className="flex items-center gap-3 p-4 border-b border-white/20">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <User className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-primary-foreground truncate">
              {user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || t("sideMenu.user")}
            </p>
            <p className="text-xs text-white/70 truncate">{user?.email || ""}</p>
          </div>
        </div>

        {/* Serial List */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-bold text-white/70">{t("sideMenu.mySerials")}</span>
            <span className="text-xs text-white/40">({serials.length})</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 alert-history-scroll">
            {pageSerials.length === 0 ? (
              <p className="text-white/50 text-sm text-center py-4">{t("sideMenu.noSerials")}</p>
            ) : (
              pageSerials.map((serial) => {
                const badge = PLAN_BADGE[serial.plan_type] || PLAN_BADGE.free;
                const Icon = badge.icon;
                return (
                  <div key={serial.id} className="p-3 rounded-xl bg-white/10">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold tracking-wider text-white/90">
                        {serial.serial_key}
                      </span>
                      <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
                        <Icon className="w-3 h-3" />
                        {t(`plan.${serial.plan_type}`)}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 mt-1">
                      {(deviceNameMap[serial.serial_key] || serial.device_name)
                        ? `📌 ${deviceNameMap[serial.serial_key] || serial.device_name}`
                        : `⏳ ${t("sideMenu.noDeviceConnected")}`}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Serial pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-3">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setSerialPage(i + 1)}
                  className={`w-6 h-6 rounded text-[10px] font-bold transition-colors ${
                    serialPage === i + 1
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-white/10 text-white/50"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Menu */}
        <div className="border-t border-white/20">
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <UserCog className="w-4 h-4 text-primary-foreground" />
              <span className="text-sm font-semibold text-primary-foreground">{t("sideMenu.editProfile")}</span>
            </div>
            <a
              href="https://meercop.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-white/60 hover:text-white/80 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              meercop.com {t("sideMenu.editProfileNotice")}
            </a>
          </div>
          <MenuItem icon={HelpCircle} label={t("sideMenu.helpQA")} onClick={() => { if (onHelpClick) { onHelpClick(); onClose(); } }} />
          <MenuItem icon={FileText} label={t("sideMenu.legalTerms")} onClick={() => { if (onLegalClick) { onLegalClick(); onClose(); } }} />

          {/* Manual update */}
          <button
            onClick={handleCheckUpdate}
            disabled={isUpdating}
            className="flex items-center gap-3 w-full px-4 py-4 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 text-primary-foreground ${isUpdating ? "animate-spin" : ""}`} />
            <span className="text-sm font-semibold text-primary-foreground">
              {t("sideMenu.checkUpdate")}
            </span>
          </button>

          {/* Language selector */}
          <button
            onClick={() => setShowLangs(!showLangs)}
            className="flex items-center gap-3 w-full px-4 py-4 hover:bg-white/10 transition-colors"
          >
            <Globe className="w-5 h-5 text-primary-foreground" />
            <span className="text-sm font-semibold text-primary-foreground">
              {SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)?.label || i18n.language}
            </span>
          </button>

          {showLangs && (
            <div className="px-4 pb-3 max-h-40 overflow-y-auto alert-history-scroll">
              <div className="grid grid-cols-2 gap-1">
                {SUPPORTED_LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => { i18n.changeLanguage(lang.code); setShowLangs(false); toast({ title: t("settings.languageChanged") }); }}
                    className={`text-[10px] py-1.5 px-2 rounded-lg transition-colors ${
                      i18n.language === lang.code
                        ? "bg-secondary text-secondary-foreground font-bold"
                        : "bg-white/10 text-white/60 hover:bg-white/15"
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <MenuItem icon={LogOut} label={t("sideMenu.logout")} onClick={handleSignOut} />
        </div>
      </div>
    </>
  );
};

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}

const MenuItem = ({ icon: Icon, label, onClick }: MenuItemProps) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 w-full px-4 py-4 hover:bg-white/10 transition-colors"
  >
    <Icon className="w-5 h-5 text-primary-foreground" />
    <span className="text-sm font-semibold text-primary-foreground">
      {label}
    </span>
  </button>
);

export default SideMenu;
