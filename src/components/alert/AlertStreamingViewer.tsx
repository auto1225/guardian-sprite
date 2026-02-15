import { useEffect, useRef, useState } from "react";
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";
import { Video, VideoOff, Loader2 } from "lucide-react";

interface AlertStreamingViewerProps {
  deviceId: string;
}

export default function AlertStreamingViewer({ deviceId }: AlertStreamingViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { isConnecting, isConnected, remoteStream, connect, disconnect } = useWebRTCViewer({
    deviceId,
    onError: (err) => setError(err),
  });

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="mx-4 mb-3 shrink-0">
      <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <Video size={16} className="text-white/80" />
          <span className="text-white font-bold text-sm">🎥 실시간 스트리밍</span>
          {isConnected && (
            <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="relative aspect-video bg-black/40">
          {isConnecting && !isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin mb-2" />
              <span className="text-sm text-white/60">스트리밍 연결 중...</span>
            </div>
          )}
          {error && !isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">{error}</span>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain ${isConnected ? "" : "hidden"}`}
          />
        </div>
      </div>
    </div>
  );
}
