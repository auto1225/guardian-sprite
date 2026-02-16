import { Settings, ChevronDown, Battery, Laptop, Monitor, Smartphone } from "lucide-react";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  isMain?: boolean;
  onSelect: () => void;
}

const getDeviceIcon = (deviceType: Device["device_type"]) => {
  switch (deviceType) {
    case "laptop":
      return Laptop;
    case "desktop":
      return Monitor;
    case "smartphone":
      return Smartphone;
    default:
      return Laptop;
  }
};

const DeviceCard = ({ device, isSelected, isMain, onSelect }: DeviceCardProps) => {
  const DeviceIcon = getDeviceIcon(device.device_type);
  const batteryLevel = device.battery_level ?? 100;
  
  const getStatusColor = () => {
    if (device.status === "alert") return "bg-destructive";
    if (device.status === "monitoring") return "bg-status-active";
    if (device.status === "online") return "bg-primary";
    return "bg-muted-foreground";
  };

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-xl cursor-pointer transition-all backdrop-blur-md ${
        isSelected
          ? "bg-white/20 border-2 border-white/50 shadow-[0_0_15px_rgba(255,255,255,0.15)]"
          : "bg-white/8 border border-white/15 hover:bg-white/12"
      }`}
    >
      {/* Row 1: Name + ON/OFF */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMain && (
            <span className="bg-secondary/90 text-secondary-foreground px-2 py-0.5 rounded-md text-xs font-bold shrink-0 shadow-sm">
              MAIN
            </span>
          )}
          <span className="text-white font-semibold text-sm drop-shadow-sm break-all line-clamp-2">{device.name}</span>
        </div>
        {device.device_type !== "smartphone" && (
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold shadow-sm shrink-0 ${
              device.is_monitoring
                ? "bg-status-active/90 text-white shadow-[0_0_8px_rgba(76,175,80,0.4)]"
                : "bg-white/15 text-white/70 backdrop-blur-sm"
            }`}
          >
            {device.is_monitoring ? "ON" : "OFF"}
          </span>
        )}
      </div>

      {/* Row 2: Status icons + Battery */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <StatusIcon active={device.status !== "offline"} label="Laptop" />
          {device.device_type !== "smartphone" && (
            <StatusIcon active={device.is_monitoring} label="MeerCOP" isMeerCOP />
          )}
          <StatusIcon active={device.status !== "offline" && device.is_network_connected} label="Network" isNetwork />
          <StatusIcon active={device.status !== "offline" && device.is_camera_connected} label="Camera" isCamera />
        </div>
        <div className="flex items-center gap-0.5">
          <span className="text-white/90 text-xs drop-shadow-sm">{batteryLevel}%</span>
          <Battery className={`w-4 h-4 ${batteryLevel < 20 ? "text-red-400" : "text-white/80"}`} />
        </div>
      </div>
    </div>
  );
};

interface StatusIconProps {
  active: boolean;
  label: string;
  isMeerCOP?: boolean;
  isNetwork?: boolean;
  isCamera?: boolean;
}

const StatusIcon = ({ active, isMeerCOP, isNetwork, isCamera }: StatusIconProps) => {
  const baseClass = "w-6 h-6 rounded-full flex items-center justify-center shadow-sm";
  const activeClass = active
    ? "bg-status-active/90 shadow-[0_0_6px_rgba(76,175,80,0.3)]"
    : "bg-red-500/80 shadow-[0_0_6px_rgba(239,68,68,0.3)]";

  return (
    <div className={`${baseClass} ${activeClass}`}>
      {isMeerCOP ? (
        <span className="text-white text-xs font-bold">M</span>
      ) : isNetwork ? (
        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C7.5 3 3.5 5 1 8l1.5 1.5C4.5 7.5 8 6 12 6s7.5 1.5 9.5 3.5L23 8c-2.5-3-6.5-5-11-5zm0 6c-3 0-5.5 1.5-7 3.5L6.5 14c1-1.5 3-2.5 5.5-2.5s4.5 1 5.5 2.5l1.5-1.5c-1.5-2-4-3.5-7-3.5zm0 6c-1.5 0-3 .5-4 1.5L12 21l4-4.5c-1-.5-2.5-1.5-4-1.5z" />
        </svg>
      ) : isCamera ? (
        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          <path d="M20 4h-3.2l-1.8-2H9l-1.8 2H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm-8 13a5 5 0 110-10 5 5 0 010 10z" />
        </svg>
      ) : (
        <Laptop className="w-3 h-3 text-white" />
      )}
    </div>
  );
};

export default DeviceCard;
