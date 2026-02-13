import { Settings } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import laptopOn from "@/assets/laptop-on.png";
import laptopOff from "@/assets/laptop-off.png";
import wifiOn from "@/assets/wifi-on.png";
import wifiOff from "@/assets/wifi-off.png";
import cameraOn from "@/assets/camera-on.png";
import cameraOff from "@/assets/camera-off.png";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface StatusIconsProps {
  device?: Device | null;
  onIconClick?: (type: "laptop" | "meercop" | "network" | "camera" | "settings") => void;
}

interface StatusItemProps {
  iconOn: string;
  iconOff: string;
  label: string;
  isActive: boolean;
  batteryLevel?: number;
  onClick?: () => void;
}

const StatusItem = ({ iconOn, iconOff, label, isActive, batteryLevel, onClick }: StatusItemProps) => {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <div className="relative">
        {batteryLevel !== undefined && (
          <div
            className="absolute -top-3 left-0 text-[10px] font-bold"
            style={{ color: 'white', textShadow: '0 1px 3px hsla(0,0%,0%,0.3)' }}
          >
            {batteryLevel}%
          </div>
        )}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: isActive ? 'hsla(52, 100%, 60%, 0.2)' : 'hsla(0, 0%, 100%, 0.1)',
            border: isActive ? '1px solid hsla(52, 100%, 60%, 0.3)' : '1px solid hsla(0, 0%, 100%, 0.15)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: isActive ? '0 0 16px hsla(52, 100%, 60%, 0.15)' : 'none',
          }}
        >
          <img 
            src={isActive ? iconOn : iconOff} 
            alt={label} 
            className="w-7 h-7 object-contain"
            style={!isActive ? { opacity: 0.5 } : undefined}
          />
        </div>
      </div>
      <span
        className="text-xs font-semibold"
        style={{ color: 'white', textShadow: '0 1px 2px hsla(0,0%,0%,0.25)' }}
      >
        {label}
      </span>
    </button>
  );
};

const StatusIcons = ({ device, onIconClick }: StatusIconsProps) => {
  const isOnline = device?.status !== "offline";
  const batteryLevel = device?.battery_level ?? 100;
  const isNetworkConnected = device?.is_network_connected ?? false;
  const isCameraConnected = device?.is_camera_connected ?? false;

  console.log("[StatusIcons] Device state:", {
    id: device?.id?.slice(0, 8),
    camera: isCameraConnected,
    network: isNetworkConnected,
    status: device?.status,
  });

  return (
    <div className="flex justify-center gap-8 py-3 px-4">
      <StatusItem 
        iconOn={laptopOn}
        iconOff={laptopOff}
        label="Laptop" 
        isActive={isOnline}
        batteryLevel={batteryLevel}
        onClick={() => onIconClick?.("laptop")}
      />
      <StatusItem 
        iconOn={wifiOn}
        iconOff={wifiOff}
        label="Network" 
        isActive={isOnline && isNetworkConnected}
        onClick={() => onIconClick?.("network")}
      />
      <StatusItem 
        iconOn={cameraOn}
        iconOff={cameraOff}
        label="Camera" 
        isActive={isOnline && isCameraConnected}
        onClick={() => onIconClick?.("camera")}
      />
      <button
        onClick={() => onIconClick?.("settings")}
        className="flex flex-col items-center gap-1"
      >
        <div
          className="w-12 h-12 flex items-center justify-center rounded-full"
          style={{
            background: 'hsla(0, 0%, 100%, 0.1)',
            border: '1px solid hsla(0, 0%, 100%, 0.15)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <Settings className="w-7 h-7" style={{ color: 'hsla(0, 0%, 100%, 0.8)' }} />
        </div>
        <span
          className="text-xs font-semibold"
          style={{ color: 'white', textShadow: '0 1px 2px hsla(0,0%,0%,0.25)' }}
        >
          Settings
        </span>
      </button>
    </div>
  );
};

export default StatusIcons;
