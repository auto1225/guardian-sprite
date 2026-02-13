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
        <div
          className="rounded-full px-4 py-1.5 flex items-center gap-2"
          style={{
            background: 'hsla(52, 100%, 60%, 0.2)',
            border: '1px solid hsla(52, 100%, 60%, 0.4)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 0 16px hsla(52, 100%, 60%, 0.15)',
          }}
        >
          <span className="font-extrabold text-sm" style={{ color: 'hsl(52, 100%, 60%)', textShadow: '0 1px 3px hsla(0,0%,0%,0.25)' }}>
            {selectedDevice.name}
          </span>
          <Settings className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
          {devices.length > 1 && (
            isExpanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
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
