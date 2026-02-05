import { Menu } from "lucide-react";
import AlertPanel from "@/components/AlertPanel";

interface HeaderProps {
  onMenuClick?: () => void;
  onDeviceManageClick?: () => void;
  unreadCount?: number;
  deviceId?: string | null;
}

const Header = ({ onMenuClick, onDeviceManageClick, unreadCount = 0, deviceId }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-white/20">
      <button className="p-2 text-primary-foreground" onClick={onMenuClick}>
        <Menu className="w-7 h-7" strokeWidth={2.5} />
      </button>
      
      <div className="flex flex-col items-center">
        <span className="text-primary-foreground font-bold text-2xl tracking-wide italic">
          Meer
        </span>
        <span className="text-primary-foreground font-black text-xl -mt-2">COP</span>
      </div>
      
      <AlertPanel deviceId={deviceId || null} />
    </header>
  );
};

export default Header;