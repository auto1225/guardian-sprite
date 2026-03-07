import { RefreshCw, Mic, MicOff, VideoOff, Play, Maximize, Minimize, Volume2, VolumeX, Circle, Square, Camera, Pause } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

/** 마운트 즉시 play()를 시도하고, 실패 시 탭 안내를 보여주는 오버레이 */
const TapToPlayOverlay = ({ onPlay }: { onPlay: () => void }) => {
  const { t } = useTranslation();
  useEffect(() => { onPlay(); }, []);
  return (
    <div className="absolute inset-0 cursor-pointer z-20 flex flex-col items-center justify-center bg-black/40" onClick={onPlay}>
      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-2">
        <Play className="w-5 h-5 text-white ml-0.5" />
      </div>
      <p className="text-white/80 text-sm font-medium">{t("cameraViewer.tapToPlay")}</p>
    </div>
  );
};

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
  isPaused: boolean;
  deviceType?: string;
  // Control callbacks for fullscreen mode
  onToggleMute?: () => void;
  onToggleRecording?: () => void;
  onTogglePause?: () => void;
  onCapture?: () => void;
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
  isPaused,
  deviceType,
  onToggleMute,
  onToggleRecording,
  onTogglePause,
  onCapture,
}: CameraViewerProps) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(isPaused);
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Pinch-to-zoom state
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);

  // 오디오 레벨 시각화
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnimFrameRef = useRef<number | null>(null);

  // Orientation detection — use screen.orientation API + resize fallback
  useEffect(() => {
    const checkOrientation = () => {
      if (screen.orientation) {
        setIsLandscape(screen.orientation.type.startsWith("landscape"));
      } else {
        setIsLandscape(window.innerWidth > window.innerHeight);
      }
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    const handleOrientationChange = () => setTimeout(checkOrientation, 100);
    window.addEventListener("orientationchange", handleOrientationChange);
    screen.orientation?.addEventListener?.("change", checkOrientation);
    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", handleOrientationChange);
      screen.orientation?.removeEventListener?.("change", checkOrientation);
    };
  }, []);

  // Auto-hide controls in fullscreen landscape
  useEffect(() => {
    if (isFullscreen && isLandscape && showControls) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
      return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
    }
  }, [isFullscreen, isLandscape, showControls]);

  const handleVideoAreaTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isFullscreen && isLandscape) {
      setShowControls(prev => !prev);
    }
  }, [isFullscreen, isLandscape]);

  // Pinch-to-zoom handlers
  const getTouchDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchStartDistRef.current = getTouchDistance(e.touches);
      pinchStartScaleRef.current = zoomScale;
      // Set zoom origin to midpoint of two fingers
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) / rect.width * 100;
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) / rect.height * 100;
        setZoomOrigin({ x: mx, y: my });
      }
    }
  }, [zoomScale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches);
      const newScale = Math.min(5, Math.max(1, pinchStartScaleRef.current * (dist / pinchStartDistRef.current)));
      setZoomScale(newScale);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    pinchStartDistRef.current = null;
    // Reset zoom if close to 1
    if (zoomScale < 1.05) setZoomScale(1);
  }, [zoomScale]);

  // 오디오 레벨 모니터링
  useEffect(() => {
    if (!remoteStream) { setAudioLevel(0); setHasAudioTrack(false); return; }
    const audioTracks = remoteStream.getAudioTracks();
    setHasAudioTrack(audioTracks.length > 0);
    if (audioTracks.length === 0) return;
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(remoteStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      audioContextRef.current = ctx;
      const resumeOnInteraction = () => {
        if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume().catch(() => {});
      };
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
      document.addEventListener('click', resumeOnInteraction, { once: true });
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        setAudioLevel(sum / dataArray.length / 255);
        audioAnimFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
      return () => {
        if (audioAnimFrameRef.current) cancelAnimationFrame(audioAnimFrameRef.current);
        ctx.close().catch(() => {});
        audioContextRef.current = null;
      };
    } catch (e) {
      console.warn("[CameraViewer] AudioContext error:", e);
    }
  }, [remoteStream]);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Fullscreen toggle — unlock orientation so device can rotate freely
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        try { (screen.orientation as any)?.unlock?.(); } catch (_) {}
      }).catch(err => console.warn("[CameraViewer] Fullscreen failed:", err));
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (fs) setShowControls(true);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // 일시정지: 현재 프레임 캡처
  useEffect(() => {
    isPausedRef.current = isPaused;
    if (!isPaused) { setPausedFrameUrl(null); return; }
    const captureFrame = () => {
      const v = videoRef.current;
      if (!v || v.videoWidth === 0 || v.videoHeight === 0) return false;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.drawImage(v, 0, 0); setPausedFrameUrl(canvas.toDataURL("image/jpeg", 0.92)); return true; }
      } catch (e) { /* ignore */ }
      return false;
    };
    if (!captureFrame()) {
      let retries = 0;
      const interval = setInterval(() => { retries++; if (captureFrame() || retries >= 10) clearInterval(interval); }, 100);
      return () => clearInterval(interval);
    }
  }, [isPaused]);

  // isMuted 반영
  useEffect(() => {
    if (videoRef.current && isVideoPlaying) videoRef.current.muted = isMuted;
  }, [isMuted, isVideoPlaying]);

  // ★ 핵심: remoteStream → video.srcObject
  const prevStreamTracksRef = useRef<string | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!remoteStream) {
      prevStreamTracksRef.current = null;
      video.pause(); video.srcObject = null; setIsVideoPlaying(false); return;
    }
    const trackIds = remoteStream.getTracks().map(t => t.id).sort().join(",");
    if (trackIds === prevStreamTracksRef.current) return;
    prevStreamTracksRef.current = trackIds;
    console.log("[CameraViewer] 📹 Setting srcObject, tracks:", remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`).join(", "));
    video.srcObject = remoteStream;
    video.muted = true;
    let playing = false;
    const markPlaying = () => { if (playing) return; playing = true; console.log("[CameraViewer] ✅ Video is playing"); setIsVideoPlaying(true); };
    video.addEventListener("playing", markPlaying);
    const tryPlay = () => {
      if (playing) return;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) return;
      v.muted = true;
      v.play().then(markPlaying).catch((err) => { if (err?.name !== "AbortError") console.warn("[CameraViewer] ⚠️ play():", err?.name, err?.message); });
    };
    tryPlay();
    const t1 = setTimeout(tryPlay, 100);
    const t2 = setTimeout(tryPlay, 300);
    const t3 = setTimeout(tryPlay, 600);
    const t4 = setTimeout(tryPlay, 1000);
    const t5 = setTimeout(tryPlay, 1500);
    video.addEventListener("loadeddata", tryPlay, { once: true });
    video.addEventListener("canplay", tryPlay, { once: true });
    const checkReadyState = () => {
      const v = videoRef.current;
      if (!v || playing) return;
      if (!v.paused && v.readyState >= 2) { markPlaying(); }
    };
    const onUserGesture = () => {
      if (!playing) tryPlay();
      const v = videoRef.current;
      if (v && playing) v.muted = isMutedRef.current;
    };
    document.addEventListener("touchstart", onUserGesture, { once: true, passive: true });
    document.addEventListener("click", onUserGesture, { once: true });
    let pollCount = 0;
    const poll = setInterval(() => {
      if (playing || pollCount >= 30) { clearInterval(poll); return; }
      pollCount++;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) { clearInterval(poll); return; }
      checkReadyState();
      if (!playing) tryPlay();
    }, 500);
    const trackCleanups: Array<() => void> = [];
    remoteStream.getTracks().forEach(track => {
      if (track.muted) {
        const fn = () => tryPlay();
        track.addEventListener("unmute", fn, { once: true });
        trackCleanups.push(() => track.removeEventListener("unmute", fn));
      }
    });
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5);
      clearInterval(poll); trackCleanups.forEach(fn => fn());
      video.removeEventListener("playing", markPlaying);
      document.removeEventListener("touchstart", onUserGesture);
      document.removeEventListener("click", onUserGesture);
    };
  }, [remoteStream]);

  // Stream 비활성화 감지
  useEffect(() => {
    if (!remoteStream) return;
    const interval = setInterval(() => {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length > 0 && videoTracks[0].readyState === "ended") setIsVideoPlaying(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [remoteStream]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handlePlayClick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;
    video.muted = isMutedRef.current;
    video.play().then(() => { setIsVideoPlaying(true); }).catch(() => {
      video.muted = true;
      video.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    });
  }, []);

  const [hasVideoFrames, setHasVideoFrames] = useState(false);
  useEffect(() => {
    if (!remoteStream) { setHasVideoFrames(false); return; }
    const checkFrames = () => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) { setHasVideoFrames(true); return true; }
      return false;
    };
    if (checkFrames()) return;
    const interval = setInterval(() => { if (checkFrames()) clearInterval(interval); }, 200);
    const timeout = setTimeout(() => clearInterval(interval), 30000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [remoteStream]);

  const showConnecting = (isConnecting && !isConnected && !remoteStream) || (!!remoteStream && !hasVideoFrames && !error);
  const showError = !!error && !isConnected && !remoteStream;
  const showVideo = !!remoteStream && hasVideoFrames;
  const showWaiting = !showConnecting && !showError && !showVideo && !remoteStream;
  const showDisconnectOverlay = showVideo && !isConnected && !isConnecting;

  const hasControls = !!(onToggleMute && onToggleRecording && onTogglePause && onCapture);
  // In fullscreen portrait: controls below video. In fullscreen landscape: overlay on video.
  const showFullscreenControls = isFullscreen && hasControls && (isStreaming || isConnected);
  const controlsOverlay = isFullscreen && isLandscape; // overlay mode

  const renderControls = () => (
    <div className={`flex items-center justify-center gap-3 ${
      controlsOverlay 
        ? `absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
        : 'py-4'
    }`}>
      <button onClick={onToggleMute}
        className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${isMuted ? "bg-white/15 hover:bg-white/25" : "bg-white/25 hover:bg-white/35"}`}
        title={isMuted ? t("cameraViewer.unmute") : t("cameraViewer.mute")}>
        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>
      <button onClick={onToggleRecording}
        className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${isRecording ? "bg-red-600 hover:bg-red-700" : "bg-white/15 hover:bg-white/25"}`}
        title={isRecording ? t("cameraViewer.stopRecording") : t("cameraViewer.startRecording")}>
        {isRecording ? <Square className="w-4 h-4" fill="white" /> : <Circle className="w-5 h-5 text-red-400" />}
      </button>
      <button onClick={onTogglePause}
        className="w-11 h-11 rounded-full flex items-center justify-center text-white bg-white/20 border border-white/30 hover:bg-white/30 transition-colors"
        title={isPaused ? t("cameraViewer.resume") : t("cameraViewer.pause")}>
        {isPaused ? <Play className="w-5 h-5 ml-0.5" /> : <Pause className="w-5 h-5" />}
      </button>
      <button onClick={onCapture}
        className="w-11 h-11 bg-white/15 rounded-full flex items-center justify-center text-white hover:bg-white/25 transition-colors"
        title={t("cameraViewer.snapshot")}>
        <Camera className="w-5 h-5" />
      </button>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`bg-black flex flex-col relative overflow-hidden ${
        isFullscreen 
          ? "w-full h-full" 
          : "flex-1 rounded-xl aspect-video"
      }`}
      onClick={handleVideoAreaTap}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: zoomScale > 1 ? 'none' : 'auto' }}
    >
      {/* Video area */}
      <div className={`relative flex items-center justify-center ${
        isFullscreen 
          ? (isLandscape ? "w-full h-full" : "w-full flex-1")
          : "w-full h-full"
      }`}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          preload="auto"
          className={`${isFullscreen ? "max-w-full max-h-full object-contain" : "w-full h-full object-cover"} ${showVideo ? "" : "hidden"}`}
          style={zoomScale > 1 ? { transform: `scale(${zoomScale})`, transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`, transition: pinchStartDistRef.current ? 'none' : 'transform 0.2s ease-out' } : undefined}
          onClick={(e) => { e.stopPropagation(); handlePlayClick(); }}
        />

        {pausedFrameUrl && isPaused && (
          <img src={pausedFrameUrl} alt="Paused frame"
            className={`absolute ${isFullscreen ? "max-w-full max-h-full object-contain" : "inset-0 w-full h-full object-cover"} z-10`}
            style={zoomScale > 1 ? { transform: `scale(${zoomScale})`, transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%` } : undefined}
          />
        )}

        {showConnecting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
            <RefreshCw className="w-8 h-8 text-white/50 animate-spin" />
            <p className="text-white/70 text-sm mt-4">{t("cameraViewer.connecting")}</p>
            <p className="text-white/50 text-xs mt-1">{t("cameraViewer.waitingForCamera", { device: t(`statusIcons.${deviceType || "laptop"}`) })}</p>
          </div>
        )}

        {showError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
            <p className="text-white/70 text-sm">{error}</p>
            <button onClick={onRetry} className="mt-4 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors">
              <RefreshCw className="w-4 h-4" />{t("cameraViewer.retry")}
            </button>
          </div>
        )}

        {showWaiting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
            <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
            <p className="text-white/70 text-sm mt-4">{t("cameraViewer.waitingForStart", { device: t(`statusIcons.${deviceType || "laptop"}`) })}</p>
          </div>
        )}

        {showDisconnectOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <VideoOff className="w-10 h-10 text-white/50 mb-2" />
            <p className="text-white/70 text-sm">{t("cameraViewer.cameraNotDetected")}</p>
            <button onClick={onRetry} className="mt-3 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors">
              <RefreshCw className="w-4 h-4" />{t("cameraViewer.retry")}
            </button>
          </div>
        )}

        {showVideo && !isVideoPlaying && isConnected && (
          <TapToPlayOverlay onPlay={handlePlayClick} />
        )}

        {/* LIVE / REC */}
        {isConnected && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
            {isRecording ? (
              <><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><span className="text-white text-xs font-bold">REC {formatDuration(recordingDuration)}</span></>
            ) : (
              <><div className="w-2 h-2 rounded-full bg-destructive animate-pulse" /><span className="text-white text-xs font-bold">LIVE</span></>
            )}
          </div>
        )}

        {/* 오디오 레벨 */}
        {isConnected && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 px-2 py-1.5 rounded">
            {hasAudioTrack ? (
              <>
                <Mic className="w-3 h-3 text-green-400" />
                <div className="flex items-end gap-[2px] h-3">
                  {[0.15, 0.3, 0.45, 0.6, 0.75].map((threshold, i) => (
                    <div key={i} className="w-[3px] rounded-sm transition-all duration-100"
                      style={{ height: `${4 + i * 2}px`, backgroundColor: audioLevel >= threshold ? audioLevel > 0.5 ? '#f59e0b' : '#4ade80' : 'rgba(255,255,255,0.2)' }} />
                  ))}
                </div>
              </>
            ) : (
              <><MicOff className="w-3 h-3 text-white/40" /><span className="text-white/40 text-[10px]">{t("cameraViewer.noAudio")}</span></>
            )}
          </div>
        )}

        {/* Fullscreen toggle */}
        <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
          className="absolute bottom-3 right-3 p-2 bg-black/60 rounded-lg hover:bg-black/80 active:bg-black/90 transition-colors z-10"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {isFullscreen ? <Minimize size={18} className="text-white" /> : <Maximize size={18} className="text-white" />}
        </button>

        {/* Controls overlay in landscape fullscreen */}
        {showFullscreenControls && controlsOverlay && renderControls()}
      </div>

      {/* Controls below video in portrait fullscreen */}
      {showFullscreenControls && !controlsOverlay && renderControls()}
    </div>
  );
};

export default CameraViewer;