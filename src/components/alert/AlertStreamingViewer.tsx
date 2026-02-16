import { useEffect, useRef, useState, useCallback } from "react";
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";
import { Video, VideoOff, Loader2, Circle } from "lucide-react";
import { saveAlertVideo } from "@/lib/alertVideoStorage";

interface AlertStreamingViewerProps {
  deviceId: string;
  alertId?: string;
}

export default function AlertStreamingViewer({ deviceId, alertId }: AlertStreamingViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showLastFrame, setShowLastFrame] = useState(false);

  const { isConnecting, isConnected, remoteStream, connect, disconnect } = useWebRTCViewer({
    deviceId,
    onError: (err) => {
      setError(err);
      // Capture last frame when connection drops
      captureLastFrame();
    },
  });

  // Capture the last frame to canvas for persistence
  const captureLastFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        setShowLastFrame(true);
      }
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      stopRecording();
      disconnect();
    };
  }, []);

  // Attach stream to video element and force play
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !remoteStream) return;

    console.log("[AlertStreaming] 📹 Attaching stream to video element", {
      streamId: remoteStream.id,
      active: remoteStream.active,
      tracks: remoteStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
    });

    video.srcObject = remoteStream;
    setShowLastFrame(false);

    // 모바일 브라우저에서 autoPlay가 작동하지 않을 수 있으므로 명시적 play() 호출
    const attemptPlay = (retries = 0) => {
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) return;
      
      v.play().then(() => {
        console.log("[AlertStreaming] ✅ Video playing!", { videoWidth: v.videoWidth, videoHeight: v.videoHeight });
      }).catch((err) => {
        console.warn("[AlertStreaming] ⚠️ play() failed (attempt", retries + 1, "):", err.message);
        if (retries < 10) {
          setTimeout(() => attemptPlay(retries + 1), 500);
        }
      });
    };
    attemptPlay();

    // 트랙이 늦게 도착할 경우 대비
    const handleAddTrack = (e: MediaStreamTrackEvent) => {
      console.log("[AlertStreaming] 🆕 Track added to stream:", e.track.kind, e.track.readyState);
      attemptPlay();
    };
    remoteStream.addEventListener("addtrack", handleAddTrack);

    // 비디오 트랙 상태 모니터링
    const videoTracks = remoteStream.getVideoTracks();
    const trackHandlers: Array<() => void> = [];
    videoTracks.forEach(track => {
      const onUnmute = () => {
        console.log("[AlertStreaming] ✅ Video track unmuted, attempting play");
        attemptPlay();
      };
      const onEnded = () => {
        console.log("[AlertStreaming] ⚠️ Video track ended");
      };
      track.addEventListener("unmute", onUnmute);
      track.addEventListener("ended", onEnded);
      trackHandlers.push(() => {
        track.removeEventListener("unmute", onUnmute);
        track.removeEventListener("ended", onEnded);
      });
    });

    // loadedmetadata 이벤트로 비디오가 실제로 데이터를 받았는지 확인
    const onLoadedMetadata = () => {
      console.log("[AlertStreaming] ✅ Video loadedmetadata:", { width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      remoteStream.removeEventListener("addtrack", handleAddTrack);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      trackHandlers.forEach(cleanup => cleanup());
    };
  }, [remoteStream]);

  // Auto-start recording when connected
  useEffect(() => {
    if (isConnected && remoteStream && !isRecording) {
      startRecording();
    }
  }, [isConnected, remoteStream]);

  // Monitor connection loss to preserve last frame
  useEffect(() => {
    if (!isConnected && !isConnecting && videoRef.current) {
      captureLastFrame();
    }
  }, [isConnected, isConnecting, captureLastFrame]);

  const startRecording = useCallback(() => {
    if (!remoteStream || mediaRecorderRef.current) return;

    try {
      const stream = new MediaStream();
      remoteStream.getTracks().forEach((t) => stream.addTrack(t));

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          // Save to IndexedDB for later playback
          if (alertId) {
            try {
              await saveAlertVideo(alertId, blob, mimeType);
              console.log("[AlertStreaming] Video saved to IndexedDB for alert:", alertId);
            } catch (err) {
              console.error("[AlertStreaming] Failed to save video:", err);
            }
          } else {
            // Fallback: direct download if no alertId
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `meercop-alert-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        }
        setIsRecording(false);
        setRecordingTime(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch (err) {
      console.error("[AlertStreaming] Recording failed:", err);
    }
  }, [remoteStream]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="mx-4 mb-3">
      <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <Video size={16} className="text-white/80" />
          <span className="text-white font-bold text-sm">🎥 실시간 스트리밍</span>
          {isRecording && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <Circle size={8} className="fill-red-500 text-red-500 animate-pulse" />
              REC {formatTime(recordingTime)}
            </span>
          )}
          {isConnected && (
            <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="relative aspect-video bg-black/40">
          {isConnecting && !isConnected && !showLastFrame && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin mb-2" />
              <span className="text-sm text-white/60">스트리밍 연결 중...</span>
            </div>
          )}
          {error && !isConnected && !showLastFrame && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">{error}</span>
            </div>
          )}
          {/* Last frame canvas - shown when disconnected */}
          <canvas
            ref={canvasRef}
            className={`w-full h-full object-contain ${showLastFrame && !isConnected ? "" : "hidden"}`}
          />
          {showLastFrame && !isConnected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">카메라가 인식되지 않습니다</span>
            </div>
          )}
          {/* Live video */}
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
