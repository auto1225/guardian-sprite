import { X, Video } from "lucide-react";

interface CameraHeaderProps {
  onClose: () => void;
  deviceName: string;
}

const CameraHeader = ({ onClose, deviceName }: CameraHeaderProps) => {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Video className="w-4 h-4 text-white" />
        </div>
        <span className="text-white font-bold text-base">카메라</span>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
        <X className="w-4 h-4 text-white/80" />
      </button>
    </div>
  );
};

export default CameraHeader;
