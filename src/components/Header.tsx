import { Plus } from "lucide-react";
import AlertPanel from "@/components/AlertPanel";

interface HeaderProps {
  onMenuClick?: () => void;
  onDeviceManageClick?: () => void;
  unreadCount?: number;
  deviceId?: string | null;
}

const Header = ({ onMenuClick, onDeviceManageClick, unreadCount = 0, deviceId }: HeaderProps) => {
  return (
    <header className="flex items-center justify-between px-4 py-2">
      <div className="w-10" /> {/* Spacer */}
      
      <div className="flex flex-col items-center">
        <span className="text-primary-foreground font-bold text-xl italic">
          Meer
        </span>
        <span className="text-primary-foreground font-black text-base -mt-1">COP</span>
      </div>
      
      <div className="flex items-center gap-1">
        <AlertPanel deviceId={deviceId || null} />
        <button className="p-1 text-primary-foreground" onClick={onDeviceManageClick}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

export default Header;