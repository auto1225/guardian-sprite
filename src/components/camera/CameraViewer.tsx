import { Camera, RefreshCw, Download } from "lucide-react";
import { useRef, useEffect } from "react";

interface CameraViewerProps {
  isStreaming: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  remoteStream: MediaStream | null;
  error: string | null;
  onRetry: () => void;
  onCapture: () => void;
}

const CameraViewer = ({
  isStreaming,
  isConnecting,
  isConnected,
  remoteStream,
  error,
  onRetry,
  onCapture,
}: CameraViewerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const handleDownload = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", 0.9);
      link.download = `meercop-capture-${Date.now()}.jpg`;
      link.click();
    }
  };

  // Not streaming yet
  if (!isStreaming) {
    return (
      <div className="flex-1 bg-black flex items-center justify-center">
        <div className="text-center text-white/50 flex flex-col items-center gap-4">
          <Camera className="w-12 h-12 opacity-50" />
          <div>
            <p>노트북 카메라를 보려면</p>
            <p className="text-sm mt-1">아래 버튼을 눌러주세요</p>
          </div>
        </div>
      </div>
    );
  }

  // Connecting
  if (isConnecting && !isConnected) {
    return (
      <div className="flex-1 bg-black flex items-center justify-center">
        <div className="text-center text-white/50 flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p>카메라 연결 중...</p>
          <p className="text-xs">노트북에서 카메라가 시작될 때까지 대기 중</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 bg-black flex items-center justify-center">
        <div className="text-center text-white/50 flex flex-col items-center gap-4">
          <p>{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // Connected with stream
  if (isConnected && remoteStream) {
    return (
      <div className="flex-1 bg-black flex items-center justify-center relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="max-w-full max-h-full object-contain"
        />
        {/* LIVE indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-1 bg-black/60 px-2 py-1 rounded">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-white text-xs font-bold">LIVE</span>
        </div>
        {/* Action buttons */}
        <div className="absolute bottom-4 right-4 flex gap-2">
          <button
            onClick={onCapture}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
            title="스냅샷 저장"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            onClick={handleDownload}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
            title="다운로드"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Waiting for connection
  return (
    <div className="flex-1 bg-black flex items-center justify-center">
      <div className="text-center text-white/50 flex flex-col items-center gap-4">
        <RefreshCw className="w-6 h-6 animate-spin" />
        <p>노트북에서 카메라 시작 대기 중...</p>
        <p className="text-xs">노트북 앱이 실행 중인지 확인하세요</p>
      </div>
    </div>
  );
};

export default CameraViewer;
