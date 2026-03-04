import { useState, useEffect } from "react";
import { Menu, Plus, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import AlertPanel from "@/components/AlertPanel";
import { PhotoAlert } from "@/lib/photoAlertStorage";
import * as Alarm from "@/lib/alarmSound";
import logo from "@/assets/logo.png";

interface HeaderProps {
  onMenuClick?: () => void;
  onDeviceManageClick?: () => void;
  unreadCount?: number;
  deviceId?: string | null;
  onViewPhoto?: (alert: PhotoAlert) => void;
}

const Header = ({ onMenuClick, onDeviceManageClick, unreadCount = 0, deviceId, onViewPhoto }: HeaderProps) => {
  const { t } = useTranslation();
  const [muted, setMuted] = useState(Alarm.isMuted());

  // localStorage 변경 감지 (다른 탭 등)
  useEffect(() => {
    const check = () => setMuted(Alarm.isMuted());
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  const toggleMute = () => {
    const next = !muted;
    Alarm.setMuted(next);
    setMuted(next);
  };

  return (
    <header className="flex items-center justify-between px-4 py-4">
      <button className="p-1 text-primary-foreground" onClick={onMenuClick} aria-label={t("header.openMenu")}>
        <Menu className="w-6 h-6" />
      </button>
      
      <img src={logo} alt="MeerCOP" className="h-10 object-contain absolute left-1/2 -translate-x-1/2" />
      
      <div className="flex items-center gap-1">
        <AlertPanel deviceId={deviceId || null} onViewPhoto={onViewPhoto} />
        <button
          className={`w-8 h-8 rounded-full flex items-center justify-center border backdrop-blur-sm shadow-lg active:scale-95 transition-all ${
            muted
              ? "border-red-400/50 bg-red-500/20 text-red-300"
              : "border-white/30 bg-white/15 text-primary-foreground"
          }`}
          onClick={toggleMute}
          aria-label={muted ? t("alarm.unmute") : t("alarm.mute")}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button
          className="w-8 h-8 rounded-full flex items-center justify-center border border-white/30 bg-white/15 backdrop-blur-sm text-primary-foreground shadow-lg hover:bg-white/25 active:scale-95 transition-all"
          onClick={onDeviceManageClick}
          aria-label={t("header.manageDevices")}
        >
          <Plus className="w-4.5 h-4.5" strokeWidth={2.5} />
        </button>
      </div>
    </header>
  );
};

export default Header;