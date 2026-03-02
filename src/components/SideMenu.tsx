import { useState } from "react";
import { ChevronLeft, User, LogOut, HelpCircle, UserCog, Globe, Crown, Star, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/dynamicTranslation";
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
}

const SideMenu = ({ isOpen, onClose, onHelpClick }: SideMenuProps) => {
  const { t, i18n } = useTranslation();
  const { user, serials, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [serialPage, setSerialPage] = useState(1);
  const [showLangs, setShowLangs] = useState(false);

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
              <p className="text-xs text-white/70">ver 1.0.6</p>
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
              {user?.email?.split("@")[0] || t("sideMenu.user")}
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
                      {serial.device_name ? `📌 ${serial.device_name}` : `⏳ ${t("sideMenu.noDeviceConnected")}`}
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
          <MenuItem icon={UserCog} label={t("sideMenu.editProfile")} onClick={() => { navigate("/settings"); onClose(); }} />
          <MenuItem icon={HelpCircle} label={t("sideMenu.helpQA")} onClick={() => { if (onHelpClick) { onHelpClick(); onClose(); } }} />

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
