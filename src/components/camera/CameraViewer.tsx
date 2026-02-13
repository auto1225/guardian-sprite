import { Camera, RefreshCw, Download, Video, Play, Volume2, VolumeX } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

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
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const playRetryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 안전한 재생 시도 - 여러 번 반복 시도
  const attemptPlay = useCallback(async (retryCount = 0) => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;

    try {
      video.muted = true; // 모바일에서 muted여야 autoplay 가능
      await video.play();
      console.log("[CameraViewer] ✅ Play succeeded (attempt:", retryCount + 1, ")");
      setIsVideoPlaying(true);
    } catch (err) {
      console.warn("[CameraViewer] ⚠️ Play failed (attempt:", retryCount + 1, "):", err);
      setIsVideoPlaying(false);
      
      // 최대 5회까지 500ms 간격으로 재시도
      if (retryCount < 5) {
        playRetryTimerRef.current = setTimeout(() => {
          attemptPlay(retryCount + 1);
        }, 500);
      }
    }
  }, []);

  // remoteStream이 변경되면 비디오에 연결
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !remoteStream) return;

    console.log("[CameraViewer] 📹 Setting video srcObject:", {
      streamId: remoteStream.id,
      active: remoteStream.active,
      trackCount: remoteStream.getTracks().length,
    });

    // 이전 타이머 정리
    if (playRetryTimerRef.current) {
      clearTimeout(playRetryTimerRef.current);
      playRetryTimerRef.current = null;
    }

    video.muted = true;
    video.playsInline = true;
    video.srcObject = remoteStream;

    // 메타데이터 로드 후 재생
    const onLoadedMetadata = () => {
      console.log("[CameraViewer] 📹 Metadata loaded:", video.videoWidth, "x", video.videoHeight);
      attemptPlay(0);
    };

    // 트랙 추가 이벤트 감지 - 늦게 도착하는 트랙 처리
    const onAddTrack = () => {
      console.log("[CameraViewer] 📹 Track added to stream, retrying play...");
      attemptPlay(0);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    remoteStream.addEventListener("addtrack", onAddTrack);

    // 즉시 재생 시도 (메타데이터가 이미 있을 수 있음)
    attemptPlay(0);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      remoteStream.removeEventListener("addtrack", onAddTrack);
      if (playRetryTimerRef.current) {
        clearTimeout(playRetryTimerRef.current);
        playRetryTimerRef.current = null;
      }
    };
  }, [remoteStream, attemptPlay]);

  // Stream 비활성화 감지
  useEffect(() => {
    if (!remoteStream) return;

    const checkStreamHealth = () => {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length > 0 && videoTracks[0].readyState === "ended") {
        console.log("[CameraViewer] ⚠️ Video track ended");
        setIsVideoPlaying(false);
      }
    };

    const interval = setInterval(checkStreamHealth, 5000);
    return () => clearInterval(interval);
  }, [remoteStream]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (playRetryTimerRef.current) {
        clearTimeout(playRetryTimerRef.current);
      }
    };
  }, []);

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
      <div className="flex-1 bg-black/50 rounded-xl mx-4 flex items-center justify-center aspect-video">
        <div className="text-center flex flex-col items-center gap-4">
          <Video className="w-12 h-12 text-white/50" />
          <p className="text-white/70 text-sm px-4">
            카메라를 시작하려면 아래 버튼을 눌러주세요
          </p>
        </div>
      </div>
    );
  }

  // Connecting
  if (isConnecting && !isConnected) {
    return (
      <div className="flex-1 bg-black/50 rounded-xl mx-4 flex items-center justify-center aspect-video">
        <div className="text-center flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 text-white/50 animate-spin" />
          <p className="text-white/70 text-sm">카메라 연결 중...</p>
          <p className="text-white/50 text-xs">노트북에서 카메라가 시작될 때까지 대기 중</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 bg-black/50 rounded-xl mx-4 flex items-center justify-center aspect-video">
        <div className="text-center flex flex-col items-center gap-4">
          <p className="text-white/70 text-sm">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors"
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
    const handlePlayClick = () => {
      attemptPlay(0);
    };

    const handleToggleMute = () => {
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
        setIsMuted(videoRef.current.muted);
      }
    };

    return (
      <div className="flex-1 bg-black rounded-xl mx-4 flex items-center justify-center relative overflow-hidden aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          preload="auto"
          className="w-full h-full object-contain"
          onClick={handlePlayClick}
        />

        {/* 터치하여 재생 오버레이 */}
        {!isVideoPlaying && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 cursor-pointer"
            onClick={handlePlayClick}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-2">
              <Play className="w-8 h-8 text-white ml-1" fill="white" />
            </div>
            <p className="text-white text-sm">터치하여 재생</p>
          </div>
        )}

        {/* LIVE indicator */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-white text-xs font-bold">LIVE</span>
        </div>
        {/* Action buttons */}
        <div className="absolute bottom-3 right-3 flex gap-2">
          <button
            onClick={handleToggleMute}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors ${
              isMuted ? "bg-white/20 hover:bg-white/30" : "bg-accent/80 hover:bg-accent"
            }`}
            title={isMuted ? "소리 켜기" : "소리 끄기"}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <button
            onClick={onCapture}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            title="스냅샷 저장"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            onClick={handleDownload}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors"
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
    <div className="flex-1 bg-black/50 rounded-xl mx-4 flex items-center justify-center aspect-video">
      <div className="text-center flex flex-col items-center gap-4">
        <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
        <p className="text-white/70 text-sm">노트북에서 카메라 시작 대기 중...</p>
        <p className="text-white/50 text-xs">노트북 앱이 실행 중인지 확인하세요</p>
      </div>
    </div>
  );
};

export default CameraViewer;
