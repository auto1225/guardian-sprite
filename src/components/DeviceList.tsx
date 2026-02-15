import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useDevices } from "@/hooks/useDevices";
import DeviceCard from "./DeviceCard";

interface DeviceListProps {
  isExpanded: boolean;
  onToggle: () => void;
}

const DeviceList = ({ isExpanded, onToggle }: DeviceListProps) => {
  const { devices: allDevices, selectedDevice, selectedDeviceId, setSelectedDeviceId } = useDevices();
  const devices = allDevices.filter(d => d.device_type !== "smartphone");

  if (!selectedDevice || selectedDevice.device_type === "smartphone") {
    if (devices.length === 0) return null;
    return null;
  }

  return (
    <div className="px-4 py-2">
      {/* Main device display */}
      <div
        onClick={onToggle}
        className="flex items-center justify-center gap-2 cursor-pointer"
      >
        <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-full px-4 py-1.5 flex items-center gap-2 shadow-lg">
          <span className="text-white font-bold text-sm drop-shadow-sm">
            {selectedDevice.name}
          </span>
          {devices.length > 1 && (
            isExpanded ? (
             <ChevronUp className="w-4 h-4 text-white/80" />
            ) : (
              <ChevronDown className="w-4 h-4 text-white/80" />
            )
          )}
        </div>
      </div>

      {/* Expanded device list */}
      {isExpanded && devices.length > 1 && (
        <div className="mt-3 space-y-2.5 animate-in slide-in-from-top-2 duration-200 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-3 shadow-lg">
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
