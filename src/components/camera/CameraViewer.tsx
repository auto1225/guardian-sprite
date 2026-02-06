import { Camera, RefreshCw, Download, Video } from "lucide-react";
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
      console.log("[CameraViewer] 📹 Setting video srcObject:", {
        streamId: remoteStream.id,
        active: remoteStream.active,
        trackCount: remoteStream.getTracks().length,
      });
      
      // Log all tracks
      remoteStream.getTracks().forEach((track, i) => {
        console.log(`[CameraViewer] 📹 Track ${i}:`, {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });
      
      videoRef.current.srcObject = remoteStream;
      
      // Add event listeners for video playback debugging
      const video = videoRef.current;
      
      video.onloadedmetadata = () => {
        console.log("[CameraViewer] 📹 Video metadata loaded:", {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          duration: video.duration,
        });
      };
      
      video.onplay = () => {
        console.log("[CameraViewer] ▶️ Video started playing");
      };
      
      video.onplaying = () => {
        console.log("[CameraViewer] ▶️ Video is now playing, dimensions:", video.videoWidth, "x", video.videoHeight);
      };
      
      video.onerror = (e) => {
        console.error("[CameraViewer] ❌ Video error:", e);
      };
      
      video.onstalled = () => {
        console.warn("[CameraViewer] ⚠️ Video stalled");
      };
      
      video.onwaiting = () => {
        console.log("[CameraViewer] ⏳ Video waiting for data...");
      };
      
      // Try to play immediately
      video.play().then(() => {
        console.log("[CameraViewer] ✅ Video play() succeeded");
      }).catch(err => {
        console.warn("[CameraViewer] ⚠️ Video play() failed:", err);
        // 자동 재생 실패 시 muted 상태로 다시 시도
        video.muted = true;
        video.play().catch(e => console.error("[CameraViewer] ❌ Muted play also failed:", e));
      });
    }
  }, [remoteStream]);

  // Stream 상태 모니터링 - 비활성화되면 UI에 표시
  useEffect(() => {
    if (!remoteStream) return;
    
    const checkStreamHealth = () => {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const track = videoTracks[0];
        if (track.readyState === 'ended') {
          console.log("[CameraViewer] ⚠️ Video track ended");
        }
      }
    };
    
    // 주기적으로 stream 상태 체크
    const interval = setInterval(checkStreamHealth, 5000);
    
    return () => clearInterval(interval);
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

  // Not streaming yet - show placeholder
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
    return (
      <div className="flex-1 bg-black rounded-xl mx-4 flex items-center justify-center relative overflow-hidden aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
        {/* LIVE indicator */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-white text-xs font-bold">LIVE</span>
        </div>
        {/* Action buttons */}
        <div className="absolute bottom-3 right-3 flex gap-2">
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
