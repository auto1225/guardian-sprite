import { Menu, Plus } from "lucide-react";
import AlertPanel from "@/components/AlertPanel";

interface HeaderProps {
  onMenuClick?: () => void;
  onDeviceManageClick?: () => void;
  unreadCount?: number;
  deviceId?: string | null;
}

const Header = ({ onMenuClick, onDeviceManageClick, unreadCount = 0, deviceId }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-3">
      <button className="p-2 text-primary-foreground" onClick={onMenuClick}>
        <Menu className="w-6 h-6" />
      </button>
      
      <div className="flex flex-col items-center">
        <span className="text-primary-foreground font-bold text-xl tracking-wide" style={{ fontFamily: 'system-ui' }}>
          <span className="italic">Meer</span>
        </span>
        <span className="text-primary-foreground font-black text-lg -mt-1">COP</span>
      </div>
      
      <div className="flex items-center gap-2">
        <AlertPanel deviceId={deviceId || null} />
        <button className="p-2 text-primary-foreground" onClick={onDeviceManageClick}>
          <Plus className="w-6 h-6" />
        </button>
      </div>
    </header>
  );
};

export default Header;