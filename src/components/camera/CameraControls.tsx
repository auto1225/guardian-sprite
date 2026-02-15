import { Volume2, VolumeX, Circle, Square, Camera, Play, Pause } from "lucide-react";

interface CameraControlsProps {
  isStreaming: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  onCapture: () => void;
}

const CameraControls = ({
  isStreaming,
  isPaused,
  onTogglePause,
  isMuted,
  onToggleMute,
  isRecording,
  onToggleRecording,
  onCapture,
}: CameraControlsProps) => {
  if (!isStreaming) return null;

  return (
    <div className="px-4 pb-4 flex items-center justify-center gap-3">
      <button
        onClick={onToggleMute}
        className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${
          isMuted ? "bg-white/15 hover:bg-white/25" : "bg-white/25 hover:bg-white/35"
        }`}
        title={isMuted ? "소리 켜기" : "소리 끄기"}
      >
        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>

      <button
        onClick={onToggleRecording}
        className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${
          isRecording ? "bg-red-600 hover:bg-red-700" : "bg-white/15 hover:bg-white/25"
        }`}
        title={isRecording ? "녹화 중지" : "녹화 시작"}
      >
        {isRecording ? <Square className="w-4 h-4" fill="white" /> : <Circle className="w-5 h-5 text-red-400" />}
      </button>

      <button
        onClick={onTogglePause}
        className="w-11 h-11 rounded-full flex items-center justify-center text-white bg-white/20 border border-white/30 hover:bg-white/30 transition-colors"
        title={isPaused ? "스트리밍 재개" : "스트리밍 일시정지"}
      >
        {isPaused ? <Play className="w-5 h-5 ml-0.5" /> : <Pause className="w-5 h-5" />}
      </button>

      <button
        onClick={onCapture}
        className="w-11 h-11 bg-white/15 rounded-full flex items-center justify-center text-white hover:bg-white/25 transition-colors"
        title="스냅샷 저장"
      >
        <Camera className="w-5 h-5" />
      </button>
    </div>
  );
};

export default CameraControls;
