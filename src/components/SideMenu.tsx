import { X, User, Laptop, LogOut, HelpCircle, UserCog, Globe, Lock, MapPin, Camera } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useDevices } from "@/hooks/useDevices";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/dynamicTranslation";
import { sortDevicesByOrder } from "@/lib/deviceSortOrder";
import logoImage from "@/assets/meercop-character.png";

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onPhotoHistoryClick?: () => void;
  onHelpClick?: () => void;
  onRemoteCommandsClick?: () => void;
  onLocationHistoryClick?: () => void;
}

const SideMenu = ({ isOpen, onClose, onPhotoHistoryClick, onHelpClick, onRemoteCommandsClick, onLocationHistoryClick }: SideMenuProps) => {
  const { t, i18n } = useTranslation();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { devices, selectedDeviceId, setSelectedDeviceId } = useDevices();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: t("sideMenu.loggedOut"),
      description: t("sideMenu.loggedOutDesc"),
    });
    onClose();
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleSelectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

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
            <X className="w-5 h-5 text-primary-foreground" />
          </button>
        </div>

        {/* Profile Section */}
        <div className="flex items-center gap-3 p-4 border-b border-white/20">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <User className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary-foreground">
              {user?.email?.split('@')[0] || t("sideMenu.user")}
            </p>
            <p className="text-xs text-white/70">{user?.email || 'email@example.com'}</p>
            <p className="text-xs text-white/50">{t("sideMenu.normalMember")}</p>
          </div>
        </div>

        {/* Device Section */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          <div className="flex items-center gap-1 mb-2">
            <Laptop className="w-4 h-4 text-white/70" />
            <span className="text-xs font-bold text-white/70">{t("sideMenu.targetDevices")}</span>
          </div>

          {/* Device Cards - scrollable */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 alert-history-scroll">
            {sortDevicesByOrder(devices?.filter(d => d.device_type !== "smartphone") || []).map((device) => (
              <button
                key={device.id}
                onClick={() => handleSelectDevice(device.id)}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                  device.id === selectedDeviceId 
                    ? 'bg-secondary' 
                    : 'bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Laptop className={`w-4 h-4 ${
                    device.id === selectedDeviceId 
                      ? 'text-secondary-foreground' 
                      : 'text-primary-foreground'
                  }`} />
                  <div className="text-left">
                    <p className={`text-sm font-bold ${
                      device.id === selectedDeviceId 
                        ? 'text-secondary-foreground' 
                        : 'text-primary-foreground'
                    }`}>
                      {device.name}
                    </p>
                    <p className={`text-xs ${
                      device.id === selectedDeviceId 
                        ? 'text-secondary-foreground/70' 
                        : 'text-white/70'
                    }`}>
                      {device.status === 'online' ? t("common.online") : t("common.offline")}
                      {device.battery_level && ` · ${device.battery_level}%`}
                    </p>
                  </div>
                </div>
              </button>
            ))}
            {devices?.filter(d => d.device_type !== "smartphone").length === 0 && (
              <p className="text-white/50 text-sm text-center py-4">
                {t("sideMenu.noDevices")}
              </p>
            )}
          </div>
        </div>

        {/* Bottom Menu */}
        <div className="border-t border-white/20">
          <MenuItem icon={Lock} label={t("sideMenu.remoteCommands")} onClick={() => { if (onRemoteCommandsClick) { onRemoteCommandsClick(); onClose(); } }} />
          <MenuItem icon={MapPin} label={t("sideMenu.locationHistory")} onClick={() => { if (onLocationHistoryClick) { onLocationHistoryClick(); onClose(); } }} />
          <MenuItem icon={Camera} label={t("sideMenu.photoAlertHistory")} onClick={() => { if (onPhotoHistoryClick) { onPhotoHistoryClick(); onClose(); } }} />
          <MenuItem icon={UserCog} label={t("sideMenu.editProfile")} onClick={() => handleNavigate("/settings")} />
          <MenuItem icon={HelpCircle} label={t("sideMenu.helpQA")} onClick={() => { if (onHelpClick) { onHelpClick(); onClose(); } }} />
          <button
            onClick={() => handleNavigate("/settings")}
            className="flex items-center gap-3 w-full px-4 py-4 hover:bg-white/10 transition-colors"
          >
            <Globe className="w-5 h-5 text-primary-foreground" />
            <span className="text-sm font-semibold text-primary-foreground">
              {SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)?.label || i18n.language}
            </span>
          </button>
          <MenuItem 
            icon={LogOut} 
            label={t("sideMenu.logout")} 
            onClick={handleSignOut}
          />
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
