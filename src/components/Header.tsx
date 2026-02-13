import { Menu, Plus } from "lucide-react";
import AlertPanel from "@/components/AlertPanel";
import { PhotoAlert } from "@/lib/photoAlertStorage";
import logo from "@/assets/logo.png";

interface HeaderProps {
  onMenuClick?: () => void;
  onDeviceManageClick?: () => void;
  unreadCount?: number;
  deviceId?: string | null;
  onViewPhoto?: (alert: PhotoAlert) => void;
}

const Header = ({ onMenuClick, onDeviceManageClick, unreadCount = 0, deviceId, onViewPhoto }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-4">
      <button className="p-1 text-primary-foreground" onClick={onMenuClick}>
        <Menu className="w-6 h-6" />
      </button>
      
      <img src={logo} alt="MeerCOP" className="h-10 object-contain absolute left-1/2 -translate-x-1/2" />
      
      <div className="flex items-center gap-1">
        <AlertPanel deviceId={deviceId || null} onViewPhoto={onViewPhoto} />
        <button className="p-1 text-primary-foreground" onClick={onDeviceManageClick}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

export default Header;