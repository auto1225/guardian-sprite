import { Camera } from "lucide-react";

interface CameraControlsProps {
  isStreaming: boolean;
  onStart: () => void;
  onStop: () => void;
}

const CameraControls = ({ isStreaming, onStart, onStop }: CameraControlsProps) => {
  return (
    <div className="p-4">
      {!isStreaming ? (
        <button
          onClick={onStart}
          className="w-full py-3 bg-secondary text-secondary-foreground rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors"
        >
          <Camera className="w-4 h-4" />
          카메라 시작
        </button>
      ) : (
        <button
          onClick={onStop}
          className="w-full py-3 bg-destructive text-destructive-foreground rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-destructive/90 transition-colors"
        >
          스트리밍 중지
        </button>
      )}
    </div>
  );
};

export default CameraControls;
