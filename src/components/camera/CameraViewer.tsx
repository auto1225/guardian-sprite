import { RefreshCw, Play, Mic, MicOff, VideoOff } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

interface CameraViewerProps {
  isStreaming: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  remoteStream: MediaStream | null;
  error: string | null;
  onRetry: () => void;
  isMuted: boolean;
  isRecording: boolean;
  recordingDuration: number;
}

const CameraViewer = ({
  isStreaming,
  isConnecting,
  isConnected,
  remoteStream,
  error,
  onRetry,
  isMuted,
  isRecording,
  recordingDuration,
}: CameraViewerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const playRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const playDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const playingPromiseRef = useRef<Promise<void> | null>(null);
  const isMutedRef = useRef(isMuted);

  // 오디오 레벨 시각화
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioAnimFrameRef = useRef<number | null>(null);

  // 오디오 레벨 모니터링
  useEffect(() => {
    if (!remoteStream) {
      setAudioLevel(0);
      setHasAudioTrack(false);
      return;
    }

    const audioTracks = remoteStream.getAudioTracks();
    setHasAudioTrack(audioTracks.length > 0);
    if (audioTracks.length === 0) return;

    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaStreamSource(remoteStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const resumeOnInteraction = () => {
        if (audioContextRef.current?.state === 'suspended') {
          audioContextRef.current.resume().catch(() => {});
        }
      };
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
      document.addEventListener('click', resumeOnInteraction, { once: true });

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length / 255;
        setAudioLevel(avg);
        audioAnimFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("[CameraViewer] AudioContext error:", e);
    }

    return () => {
      if (audioAnimFrameRef.current) cancelAnimationFrame(audioAnimFrameRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
    };
  }, [remoteStream]);

  // Keep ref in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const attemptPlayInternal = useCallback(async (retryCount = 0) => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;

    try {
      if (retryCount > 0 && retryCount % 5 === 0) {
        const currentStream = video.srcObject as MediaStream;
        if (currentStream) {
          console.log("[CameraViewer] 🔄 Re-assigning srcObject on retry", retryCount + 1);
          video.srcObject = null;
          video.srcObject = currentStream;
        }
      }
      
      video.muted = true;
      const p = video.play();
      playingPromiseRef.current = p;
      await p;
      setIsVideoPlaying(true);
      video.muted = isMutedRef.current;
      console.log("[CameraViewer] ✅ Play succeeded on attempt", retryCount + 1);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Stream replaced or element removed mid-play — safe to ignore
        console.log("[CameraViewer] ⏭️ play() AbortError (stream replaced), ignoring");
        return;
      }
      console.warn("[CameraViewer] Play failed (attempt:", retryCount + 1, "):", err);
      setIsVideoPlaying(false);
      if (retryCount < 20) {
        playRetryTimerRef.current = setTimeout(() => attemptPlayInternal(retryCount + 1), retryCount < 5 ? 300 : retryCount < 10 ? 600 : 1000);
      } else {
        console.error("[CameraViewer] ❌ All play attempts failed");
      }
    }
  }, []);

  // Debounced wrapper — multiple events fire near-simultaneously, only trigger once
  const attemptPlay = useCallback((retryCount = 0) => {
    if (playDebounceRef.current) clearTimeout(playDebounceRef.current);
    if (playRetryTimerRef.current) {
      clearTimeout(playRetryTimerRef.current);
      playRetryTimerRef.current = null;
    }
    playDebounceRef.current = setTimeout(() => {
      playDebounceRef.current = null;
      attemptPlayInternal(retryCount);
    }, 100);
  }, [attemptPlayInternal]);

  // isMuted prop 변경 시 비디오에 반영
  useEffect(() => {
    if (videoRef.current && isVideoPlaying) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted, isVideoPlaying]);

  // remoteStream 변경 시 비디오 연결
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !remoteStream) return;

    // 기존 타이머 정리
    if (playRetryTimerRef.current) {
      clearTimeout(playRetryTimerRef.current);
      playRetryTimerRef.current = null;
    }
    if (playDebounceRef.current) {
      clearTimeout(playDebounceRef.current);
      playDebounceRef.current = null;
    }

    setIsVideoPlaying(false);

    // 핵심: pause() → srcObject 리셋 → 새 스트림 할당
    video.pause();
    video.srcObject = null;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = remoteStream;

    const trackCleanups: Array<() => void> = [];
    let played = false;

    const tryPlay = async (source: string) => {
      if (played) return;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) return;
      
      console.log(`[CameraViewer] 🎬 tryPlay triggered by: ${source}`);
      try {
        v.muted = true;
        await v.play();
        played = true;
        setIsVideoPlaying(true);
        v.muted = isMutedRef.current;
        console.log("[CameraViewer] ✅ Play succeeded via:", source);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          console.log("[CameraViewer] ⏭️ AbortError, ignoring");
          return;
        }
        console.warn("[CameraViewer] ⚠️ play() failed via", source, ":", e?.message);
        // 실패 시 retry
        if (!played) attemptPlay(1);
      }
    };

    // 1) loadedmetadata — 가장 신뢰성 높은 이벤트
    video.addEventListener("loadedmetadata", () => tryPlay("loadedmetadata"), { once: true });

    // 2) canplay — loadedmetadata가 안 올 경우 fallback
    video.addEventListener("canplay", () => tryPlay("canplay"), { once: true });

    // 3) 즉시 시도 — 트랙이 이미 활성 상태일 수 있음 (재연결 시)
    //    50ms 딜레이로 srcObject 할당이 반영되도록
    const immediateTimer = setTimeout(() => tryPlay("immediate-fallback"), 50);

    // 4) 최종 fallback — 300ms 후에도 재생 안 되면 강제 시도
    const fallbackTimer = setTimeout(() => {
      if (!played) {
        console.log("[CameraViewer] ⏰ 300ms fallback triggered");
        attemptPlay(0);
      }
    }, 300);

    // 새로 추가된 트랙
    const onAddTrack = (e: MediaStreamTrackEvent) => {
      console.log("[CameraViewer] Track added:", e.track.kind);
      if (e.track.muted) {
        const onUnmute = () => tryPlay("track-unmute");
        e.track.addEventListener("unmute", onUnmute, { once: true });
        trackCleanups.push(() => e.track.removeEventListener("unmute", onUnmute));
      } else {
        tryPlay("track-add");
      }
    };
    remoteStream.addEventListener("addtrack", onAddTrack);

    // 기존 muted 트랙
    remoteStream.getTracks().forEach(track => {
      if (track.muted) {
        const onUnmute = () => tryPlay("existing-track-unmute");
        track.addEventListener("unmute", onUnmute, { once: true });
        trackCleanups.push(() => track.removeEventListener("unmute", onUnmute));
      }
    });

    return () => {
      clearTimeout(immediateTimer);
      clearTimeout(fallbackTimer);
      remoteStream.removeEventListener("addtrack", onAddTrack);
      trackCleanups.forEach(fn => fn());
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
        setIsVideoPlaying(false);
      }
    };
    const interval = setInterval(checkStreamHealth, 5000);
    return () => clearInterval(interval);
  }, [remoteStream]);

  useEffect(() => {
    return () => {
      if (playRetryTimerRef.current) clearTimeout(playRetryTimerRef.current);
      if (playDebounceRef.current) clearTimeout(playDebounceRef.current);
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Connecting
  if (isConnecting && !isConnected) {
    return (
      <div className="flex-1 bg-black/50 rounded-xl flex items-center justify-center aspect-video">
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
      <div className="flex-1 bg-black/50 rounded-xl flex items-center justify-center aspect-video">
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

  // Connected with stream OR was connected (show frozen frame with disconnect message)
  if (remoteStream) {
    const handlePlayClick = () => attemptPlay(0);
    const showDisconnectOverlay = !isConnected && !isConnecting;

    return (
      <div className="flex-1 bg-black rounded-xl flex items-center justify-center relative overflow-hidden aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          preload="auto"
          className="w-full h-full object-contain"
          onClick={handlePlayClick}
        />

        {/* 카메라 연결 해제 오버레이 */}
        {showDisconnectOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <VideoOff className="w-10 h-10 text-white/50 mb-2" />
            <p className="text-white/70 text-sm">카메라가 인식되지 않습니다</p>
            <button
              onClick={onRetry}
              className="mt-3 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              다시 시도
            </button>
          </div>
        )}

        {/* 터치하여 재생 오버레이 */}
        {!isVideoPlaying && isConnected && (
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

        {/* LIVE / REC indicator */}
        {isConnected && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
            {isRecording ? (
              <>
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-bold">REC {formatDuration(recordingDuration)}</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <span className="text-white text-xs font-bold">LIVE</span>
              </>
            )}
          </div>
        )}

        {/* 오디오 레벨 인디케이터 */}
        {isConnected && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 px-2 py-1.5 rounded">
            {hasAudioTrack ? (
              <>
                <Mic className="w-3 h-3 text-green-400" />
                <div className="flex items-end gap-[2px] h-3">
                  {[0.15, 0.3, 0.45, 0.6, 0.75].map((threshold, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-sm transition-all duration-100"
                      style={{
                        height: `${4 + i * 2}px`,
                        backgroundColor: audioLevel >= threshold
                          ? audioLevel > 0.5 ? '#f59e0b' : '#4ade80'
                          : 'rgba(255,255,255,0.2)',
                      }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <>
                <MicOff className="w-3 h-3 text-white/40" />
                <span className="text-white/40 text-[10px]">No Audio</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Waiting for connection
  return (
    <div className="flex-1 bg-black/50 rounded-xl flex items-center justify-center aspect-video">
      <div className="text-center flex flex-col items-center gap-4">
        <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
        <p className="text-white/70 text-sm">노트북에서 카메라 시작 대기 중...</p>
      </div>
    </div>
  );
};

export default CameraViewer;
