import { Laptop, Shield, Wifi, Camera, Check, Battery } from "lucide-react";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface StatusIconsProps {
  device?: Device | null;
  onIconClick?: (type: "laptop" | "meercop" | "network" | "camera") => void;
}

interface StatusItemProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  batteryLevel?: number;
  onClick?: () => void;
}

const StatusItem = ({ icon, label, isActive, batteryLevel, onClick }: StatusItemProps) => {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <div className="relative">
        {batteryLevel !== undefined && (
          <div className="absolute -top-3 -left-2 flex items-center gap-0.5 text-primary-foreground text-[10px]">
            <span>{batteryLevel}%</span>
            <Battery className="w-3 h-3" />
          </div>
        )}
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
          isActive ? "bg-sky-light/50 text-primary-foreground" : "bg-destructive/30 text-primary-foreground"
        }`}>
          {icon}
        </div>
        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
          isActive ? "bg-accent" : "bg-destructive"
        }`}>
          {isActive ? (
            <Check className="w-2.5 h-2.5 text-accent-foreground" strokeWidth={3} />
          ) : (
            <span className="text-white text-[10px]">✕</span>
          )}
        </div>
      </div>
      <span className="text-primary-foreground text-xs font-medium">{label}</span>
    </button>
  );
};

const StatusIcons = ({ device, onIconClick }: StatusIconsProps) => {
  const isOnline = device?.status !== "offline";
  const isMonitoring = device?.is_monitoring ?? false;
  const batteryLevel = device?.battery_level ?? 100;

  return (
    <div className="flex justify-center gap-5 py-3 px-4">
      <StatusItem 
        icon={<Laptop className="w-6 h-6" />} 
        label="Laptop" 
        isActive={isOnline}
        batteryLevel={batteryLevel}
        onClick={() => onIconClick?.("laptop")}
      />
      <StatusItem 
        icon={<Shield className="w-6 h-6" />} 
        label="MeerCOP" 
        isActive={isMonitoring}
        onClick={() => onIconClick?.("meercop")}
      />
      <StatusItem 
        icon={<Wifi className="w-6 h-6" />} 
        label="Network" 
        isActive={isOnline}
        onClick={() => onIconClick?.("network")}
      />
      <StatusItem 
        icon={<Camera className="w-6 h-6" />} 
        label="Camera" 
        isActive={true}
        onClick={() => onIconClick?.("camera")}
      />
    </div>
  );
};

export default StatusIcons;
