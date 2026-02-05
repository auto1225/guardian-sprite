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
      className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
        isSelected
          ? "bg-primary/30 border-2 border-primary-foreground"
          : "bg-sky-dark/30 border border-primary-foreground/20"
      }`}
    >
      <div className="flex items-center gap-3">
        {isMain && (
          <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs font-bold">
            MAIN
          </span>
        )}
        <span className="text-primary-foreground font-semibold">{device.name}</span>
        <Settings className="w-4 h-4 text-primary-foreground/70" />
      </div>

      <div className="flex items-center gap-3">
        {/* Battery indicator */}
        <div className="flex items-center gap-1">
          <span className="text-primary-foreground text-sm">{batteryLevel}%</span>
          <Battery className={`w-5 h-5 ${batteryLevel < 20 ? "text-destructive" : "text-primary-foreground"}`} />
        </div>

        {/* Status icons */}
        <div className="flex items-center gap-1.5">
          <StatusIcon active={device.status !== "offline"} label="Laptop" />
          <StatusIcon active={device.is_monitoring} label="MeerCOP" isMeerCOP />
          <StatusIcon active={device.status !== "offline"} label="Network" isNetwork />
          <StatusIcon active={true} label="Camera" isCamera />
        </div>

        {/* Monitoring status */}
        <span
          className={`px-3 py-1 rounded-lg text-sm font-semibold ${
            device.is_monitoring
              ? "bg-status-active text-white"
              : "bg-muted-foreground text-white"
          }`}
        >
          {device.is_monitoring ? "ON" : "OFF"}
        </span>
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
  const baseClass = "w-6 h-6 rounded-full flex items-center justify-center";
  const activeClass = active ? "bg-status-active" : "bg-destructive";

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
