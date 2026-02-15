import { Camera, StopCircle } from "lucide-react";

interface CameraControlsProps {
  isStreaming: boolean;
  onStart: () => void;
  onStop: () => void;
}

const CameraControls = ({ isStreaming, onStart, onStop }: CameraControlsProps) => {
  return (
    <div className="px-4 pb-4">
      {!isStreaming ? (
        <button
          onClick={onStart}
          className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-secondary text-secondary-foreground hover:brightness-110 shadow-lg"
        >
          <Camera className="w-4 h-4" />
          카메라 시작
        </button>
      ) : (
        <button
          onClick={onStop}
          className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-white/15 border border-white/25 text-white hover:bg-white/25"
        >
          <StopCircle className="w-4 h-4" />
          스트리밍 중지
        </button>
      )}
    </div>
  );
};

export default CameraControls;
