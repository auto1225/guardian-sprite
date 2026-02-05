import { Camera } from "lucide-react";

interface CameraControlsProps {
  isStreaming: boolean;
  onStart: () => void;
  onStop: () => void;
}

const CameraControls = ({ isStreaming, onStart, onStop }: CameraControlsProps) => {
  return (
    <div className="p-4 bg-card">
      {!isStreaming ? (
        <button
          onClick={onStart}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <Camera className="w-4 h-4" />
          카메라 보기
        </button>
      ) : (
        <button
          onClick={onStop}
          className="w-full py-3 bg-destructive text-destructive-foreground rounded-lg font-medium flex items-center justify-center gap-2"
        >
          스트리밍 중지
        </button>
      )}
    </div>
  );
};

export default CameraControls;
