import { Shield, Smartphone, Monitor, Wifi, Camera, Check } from "lucide-react";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface StatusIconsProps {
  device?: Device | null;
  onIconClick?: (type: "laptop" | "meercop" | "network" | "camera" | "phone") => void;
}

interface StatusItemProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}

const StatusItem = ({ icon, label, isActive, onClick }: StatusItemProps) => {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <div className="relative">
        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-primary">
          {icon}
        </div>
        <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ${
          isActive ? "bg-accent" : "bg-muted-foreground"
        }`}>
          <Check className="w-3 h-3 text-accent-foreground" strokeWidth={3} />
        </div>
      </div>
      <span className="text-primary-foreground text-xs font-medium whitespace-nowrap">{label}</span>
    </button>
  );
};

const StatusIcons = ({ device, onIconClick }: StatusIconsProps) => {
  const isOnline = device?.status !== "offline";
  const isMonitoring = device?.is_monitoring ?? false;

  return (
    <div className="flex justify-center gap-3 py-4 px-2 overflow-x-auto">
      <StatusItem 
        icon={<Shield className="w-7 h-7" />} 
        label="미어캅 연결" 
        isActive={isOnline}
        onClick={() => onIconClick?.("meercop")}
      />
      <StatusItem 
        icon={<Smartphone className="w-7 h-7" />} 
        label="스마트폰 앱 연결" 
        isActive={true}
        onClick={() => onIconClick?.("phone")}
      />
      <StatusItem 
        icon={<Monitor className="w-7 h-7" />} 
        label="센서상태" 
        isActive={isMonitoring}
        onClick={() => onIconClick?.("laptop")}
      />
      <StatusItem 
        icon={<Wifi className="w-7 h-7" />} 
        label="Wifi 연결" 
        isActive={isOnline}
        onClick={() => onIconClick?.("network")}
      />
      <StatusItem 
        icon={<Camera className="w-7 h-7" />} 
        label="카메라 활성화" 
        isActive={true}
        onClick={() => onIconClick?.("camera")}
      />
    </div>
  );
};

export default StatusIcons;
