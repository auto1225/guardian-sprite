import { ChevronDown, ChevronUp, Settings } from "lucide-react";
import { useState } from "react";
import { useDevices } from "@/hooks/useDevices";
import DeviceCard from "./DeviceCard";

interface DeviceListProps {
  isExpanded: boolean;
  onToggle: () => void;
}

const DeviceList = ({ isExpanded, onToggle }: DeviceListProps) => {
  const { devices, selectedDevice, selectedDeviceId, setSelectedDeviceId } = useDevices();

  if (!selectedDevice) return null;

  return (
    <div className="px-4 py-2">
      {/* Main device display */}
      <div
        onClick={onToggle}
        className="flex items-center justify-center gap-2 cursor-pointer"
      >
        <div className="bg-secondary/90 rounded-full px-4 py-1.5 flex items-center gap-2">
          <span className="text-secondary-foreground font-bold text-sm">
            {selectedDevice.name}
          </span>
          <Settings className="w-4 h-4 text-secondary-foreground" />
          {devices.length > 1 && (
            isExpanded ? (
              <ChevronUp className="w-4 h-4 text-secondary-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-secondary-foreground" />
            )
          )}
        </div>
      </div>

      {/* Expanded device list */}
      {isExpanded && devices.length > 1 && (
        <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
          {devices.map((device, index) => (
            <DeviceCard
              key={device.id}
              device={device}
              isSelected={device.id === selectedDeviceId}
              isMain={index === 0}
              onSelect={() => setSelectedDeviceId(device.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DeviceList;
