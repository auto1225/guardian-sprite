import { Settings } from "lucide-react";

interface DeviceSelectorProps {
  deviceName: string;
  onClick?: () => void;
}

const DeviceSelector = ({ deviceName, onClick }: DeviceSelectorProps) => {
  return (
    <div className="flex justify-center mt-2">
      <button 
        onClick={onClick}
        className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground px-5 py-2 rounded-full font-semibold text-sm transition-all shadow-md"
      >
        <span>{deviceName}</span>
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
};

export default DeviceSelector;