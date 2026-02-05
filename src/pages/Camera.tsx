import { ArrowLeft, Camera, RefreshCw, Download } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Database } from "@/integrations/supabase/types";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 카메라 시작
  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setIsStreaming(true);
      setIsLoading(false);
    } catch (err) {
      console.error("카메라 접근 오류:", err);
      setError("카메라에 접근할 수 없습니다. 권한을 확인해주세요.");
      setIsLoading(false);
    }
  }, []);

  // 카메라 중지
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  // 스냅샷 캡처
  const captureSnapshot = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0);
    
    // 다운로드
    const link = document.createElement("a");
    link.download = `meercop-snapshot-${Date.now()}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.9);
    link.click();
    
    toast({
      title: "스냅샷 저장됨",
      description: "사진이 다운로드되었습니다.",
    });
  }, [toast]);

  // 모달 닫힐 때 정리
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setError(null);
    }
  }, [isOpen, stopCamera]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

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
            카메라를 실시간으로 확인할 수 있습니다.
          </p>
        </div>
      </div>

      {/* Main video area */}
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {/* Hidden canvas for snapshot */}
        <canvas ref={canvasRef} className="hidden" />
        
        {!isStreaming && !isLoading ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <Camera className="w-12 h-12 opacity-50" />
            <div>
              <p>카메라를 보려면</p>
              <p className="text-sm mt-1">아래 버튼을 눌러주세요</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p>카메라 연결 중...</p>
          </div>
        ) : error ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <p>{error}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              다시 시도
            </button>
          </div>
        ) : (
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
              <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-white text-xs font-bold">LIVE</span>
            </div>
            {/* Snapshot button */}
            <button
              onClick={captureSnapshot}
              className="absolute bottom-4 right-4 w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              title="스냅샷 저장"
            >
              <Download className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Stream control button */}
      <div className="p-4 bg-card">
        {!isStreaming ? (
          <button
            onClick={startCamera}
            disabled={isLoading}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            {isLoading ? "연결 중..." : "카메라 보기"}
          </button>
        ) : (
          <button
            onClick={stopCamera}
            className="w-full py-3 bg-destructive text-destructive-foreground rounded-lg font-medium flex items-center justify-center gap-2"
          >
            카메라 끄기
          </button>
        )}
      </div>
    </div>
  );
};

export default CameraPage;
