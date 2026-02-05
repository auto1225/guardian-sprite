import { X } from "lucide-react";

interface CameraHeaderProps {
  onClose: () => void;
  deviceName: string;
}

const CameraHeader = ({ onClose, deviceName }: CameraHeaderProps) => {
  return (
    <div className="flex items-center justify-between p-4 border-b border-white/20 bg-primary">
      <h2 className="text-lg font-bold text-primary-foreground">카메라</h2>
      <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
        <X className="w-5 h-5 text-primary-foreground" />
      </button>
    </div>
  );
};

export default CameraHeader;
