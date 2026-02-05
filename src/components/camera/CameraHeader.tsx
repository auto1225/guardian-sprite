import { ArrowLeft } from "lucide-react";

interface CameraHeaderProps {
  onClose: () => void;
  deviceName: string;
}

const CameraHeader = ({ onClose, deviceName }: CameraHeaderProps) => {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-card-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-bold text-lg italic">Meer</span>
          <span className="font-black text-lg -mt-1">COP</span>
        </div>
        <div className="w-6" />
      </div>

      {/* Device name */}
      <div className="flex justify-center py-3">
        <div className="bg-secondary/90 rounded-full px-4 py-1.5">
          <span className="text-secondary-foreground font-bold text-sm">
            {deviceName}
          </span>
        </div>
      </div>

      {/* Camera info banner */}
      <div className="bg-primary px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-status-active rounded-full flex items-center justify-center">
          <span className="text-white text-sm">📷</span>
        </div>
        <div>
          <p className="text-primary-foreground font-bold text-sm">Camera</p>
          <p className="text-primary-foreground/70 text-xs">
            노트북 카메라를 실시간으로 확인할 수 있습니다.
          </p>
        </div>
      </div>
    </>
  );
};

export default CameraHeader;
