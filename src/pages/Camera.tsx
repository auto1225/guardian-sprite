import { ArrowLeft, Camera, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Database } from "@/integrations/supabase/types";
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";
import { useToast } from "@/hooks/use-toast";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface CameraPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const CameraPage = ({ device, isOpen, onClose }: CameraPageProps) => {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { isConnecting, isConnected, remoteStream, connect, disconnect } = useWebRTCViewer({
    deviceId: device.id,
    onError: (err) => {
      setError(err);
      toast({
        title: "연결 오류",
        description: err,
        variant: "destructive",
      });
    },
  });

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Cleanup when modal closes
  useEffect(() => {
    if (!isOpen) {
      disconnect();
      setError(null);
    }
  }, [isOpen, disconnect]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-card z-50 flex flex-col">
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
            {device.name}
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

      {/* Main video area */}
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {!isConnecting && !isConnected ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <Camera className="w-12 h-12 opacity-50" />
            <div>
              <p>노트북 카메라를 보려면</p>
              <p className="text-sm mt-1">아래 버튼을 눌러주세요</p>
            </div>
          </div>
        ) : isConnecting ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p>카메라 연결 중...</p>
          </div>
        ) : error ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <p>{error}</p>
            <button
              onClick={connect}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              다시 시도
            </button>
          </div>
        ) : isConnected ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full object-contain"
            />
            {/* LIVE indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-1 bg-black/60 px-2 py-1 rounded">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-xs font-bold">LIVE</span>
            </div>
          </>
        ) : (
          <div className="text-center text-white/50">
            <p>노트북에서 카메라가 활성화되지 않았습니다</p>
          </div>
        )}
      </div>

      {/* Stream control button */}
      <div className="p-4 bg-card">
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            {isConnecting ? "연결 중..." : "카메라 보기"}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="w-full py-3 bg-destructive text-destructive-foreground rounded-lg font-medium flex items-center justify-center gap-2"
          >
            스트리밍 중지
          </button>
        )}
      </div>
    </div>
  );
};

export default CameraPage;
