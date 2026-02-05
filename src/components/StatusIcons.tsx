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
          <div className="absolute -top-2 -left-1 flex items-center gap-0.5 text-primary-foreground text-xs">
            <span>{batteryLevel}%</span>
            <Battery className="w-3 h-3" />
          </div>
        )}
        <div className={`w-14 h-14 rounded-lg flex items-center justify-center text-primary-foreground relative ${
          isActive ? "bg-sky-light/50" : "bg-destructive/30"
        }`}>
          {icon}
          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ${
            isActive ? "bg-status-active" : "bg-destructive"
          }`}>
            {isActive ? (
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            ) : (
              <span className="text-white text-xs">✕</span>
            )}
          </div>
        </div>
      </div>
      <span className="text-primary-foreground text-sm font-medium">{label}</span>
    </button>
  );
};

const StatusIcons = ({ device, onIconClick }: StatusIconsProps) => {
  const isOnline = device?.status !== "offline";
  const isMonitoring = device?.is_monitoring ?? false;
  const batteryLevel = device?.battery_level ?? 100;

  return (
    <div className="flex justify-center gap-6 mt-6 px-4">
      <StatusItem 
        icon={<Laptop className="w-8 h-8" />} 
        label="Laptop" 
        isActive={isOnline}
        batteryLevel={batteryLevel}
        onClick={() => onIconClick?.("laptop")}
      />
      <StatusItem 
        icon={<Shield className="w-8 h-8" />} 
        label="MeerCOP" 
        isActive={isMonitoring}
        onClick={() => onIconClick?.("meercop")}
      />
      <StatusItem 
        icon={<Wifi className="w-8 h-8" />} 
        label="Network" 
        isActive={isOnline}
        onClick={() => onIconClick?.("network")}
      />
      <StatusItem 
        icon={<Camera className="w-8 h-8" />} 
        label="Camera" 
        isActive={true}
        onClick={() => onIconClick?.("camera")}
      />
    </div>
  );
};

export default StatusIcons;
