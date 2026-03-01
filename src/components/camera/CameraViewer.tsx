import { RefreshCw, Mic, MicOff, VideoOff, Play } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
/** 마운트 즉시 play()를 시도하고, 실패 시 탭 안내를 보여주는 오버레이 */
const TapToPlayOverlay = ({ onPlay }: { onPlay: () => void }) => {
  const { t } = useTranslation();

  useEffect(() => {
    // 마운트 시 자동으로 play 시도 (이미 사용자 제스처 컨텍스트에 있을 수 있음)
    onPlay();
  }, []);

  return (
    <div
      className="absolute inset-0 cursor-pointer z-20 flex flex-col items-center justify-center bg-black/40"
      onClick={onPlay}
    >
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
}: CameraViewerProps) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(isPaused);
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);

  // 오디오 레벨 시각화
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
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
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const source = ctx.createMediaStreamSource(remoteStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      audioContextRef.current = ctx;

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
        if (ctx) {
          ctx.drawImage(v, 0, 0);
          setPausedFrameUrl(canvas.toDataURL("image/jpeg", 0.92));
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    };

    if (!captureFrame()) {
      let retries = 0;
      const interval = setInterval(() => {
        retries++;
        if (captureFrame() || retries >= 10) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPaused]);

  // isMuted 반영
  useEffect(() => {
    if (videoRef.current && isVideoPlaying) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted, isVideoPlaying]);

  // ★ 핵심: remoteStream → video.srcObject 직접 설정 + 공격적 autoplay
  const prevStreamTracksRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!remoteStream) {
      prevStreamTracksRef.current = null;
      video.pause();
      video.srcObject = null;
      setIsVideoPlaying(false);
      return;
    }

    const trackIds = remoteStream.getTracks().map(t => t.id).sort().join(",");
    if (trackIds === prevStreamTracksRef.current) return;
    prevStreamTracksRef.current = trackIds;

    console.log("[CameraViewer] 📹 Setting srcObject, tracks:",
      remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`).join(", "));

    video.srcObject = remoteStream;
    video.muted = true;

    let playing = false;
    const markPlaying = () => {
      if (playing) return;
      playing = true;
      console.log("[CameraViewer] ✅ Video is playing");
      setIsVideoPlaying(true);
    };

    // playing 이벤트
    video.addEventListener("playing", markPlaying);

    const tryPlay = () => {
      if (playing) return;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) return;
      v.muted = true;
      console.log("[CameraViewer] 🎬 Attempting play(), readyState:", v.readyState, "paused:", v.paused, "videoWidth:", v.videoWidth);
      v.play().then(markPlaying).catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[CameraViewer] ⚠️ play():", err?.name, err?.message);
        }
      });
    };

    // ★ 즉시 + 점진적 재시도 (더 공격적)
    tryPlay();
    const t1 = setTimeout(tryPlay, 100);
    const t2 = setTimeout(tryPlay, 300);
    const t3 = setTimeout(tryPlay, 600);
    const t4 = setTimeout(tryPlay, 1000);
    const t5 = setTimeout(tryPlay, 1500);

    video.addEventListener("loadeddata", tryPlay, { once: true });
    video.addEventListener("canplay", tryPlay, { once: true });

    // ★ readyState 감시: 이미 재생 가능한 상태인데 playing 이벤트가 안 올 때
    const checkReadyState = () => {
      const v = videoRef.current;
      if (!v || playing) return;
      if (!v.paused && v.readyState >= 2) {
        console.log("[CameraViewer] ✅ Video ready (readyState check)");
        markPlaying();
      }
    };

    // ★ 모바일 핵심: document 레벨 터치/클릭으로 play() 트리거
    const onUserGesture = () => {
      if (!playing) {
        console.log("[CameraViewer] 👆 User gesture detected, triggering play");
        tryPlay();
      }
      const v = videoRef.current;
      if (v && playing) {
        v.muted = isMutedRef.current;
      }
    };
    document.addEventListener("touchstart", onUserGesture, { once: true, passive: true });
    document.addEventListener("click", onUserGesture, { once: true });

    // ★ 폴링 fallback (더 빠른 주기)
    let pollCount = 0;
    const poll = setInterval(() => {
      if (playing || pollCount >= 30) { clearInterval(poll); return; }
      pollCount++;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) { clearInterval(poll); return; }
      checkReadyState();
      if (!playing) tryPlay();
    }, 500);

    // 트랙 unmute 시 재생
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
      clearInterval(poll);
      trackCleanups.forEach(fn => fn());
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
      if (videoTracks.length > 0 && videoTracks[0].readyState === "ended") {
        setIsVideoPlaying(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [remoteStream]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ★ 터치하여 재생: 사용자 제스처 컨텍스트에서 play + unmute
  const handlePlayClick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;
    video.muted = isMutedRef.current;
    video.play().then(() => {
      console.log("[CameraViewer] ✅ Manual play succeeded");
      setIsVideoPlaying(true);
    }).catch((err) => {
      // muted로 재시도
      video.muted = true;
      video.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    });
  }, []);

  // ★ 비디오 프레임 감지: videoWidth > 0 폴링 (간단하고 확실한 방법)
  const [hasVideoFrames, setHasVideoFrames] = useState(false);
  
  useEffect(() => {
    if (!remoteStream) { setHasVideoFrames(false); return; }
    
    const checkFrames = () => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        setHasVideoFrames(true);
        return true;
      }
      return false;
    };
    
    if (checkFrames()) return;
    
    const interval = setInterval(() => {
      if (checkFrames()) clearInterval(interval);
    }, 200);
    const timeout = setTimeout(() => clearInterval(interval), 30000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [remoteStream]);

  const showConnecting = (isConnecting && !isConnected && !remoteStream) || (!!remoteStream && !hasVideoFrames && !error);
  const showError = !!error && !isConnected && !remoteStream;
  const showVideo = !!remoteStream && hasVideoFrames;
  const showWaiting = !showConnecting && !showError && !showVideo && !remoteStream;
  const showDisconnectOverlay = showVideo && !isConnected && !isConnecting;

  return (
    <div className="flex-1 bg-black rounded-xl flex items-center justify-center relative overflow-hidden aspect-video">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        preload="auto"
        className={`w-full h-full object-cover ${showVideo ? "" : "hidden"}`}
        onClick={handlePlayClick}
      />

      {pausedFrameUrl && isPaused && (
        <img
          src={pausedFrameUrl}
          alt="Paused frame"
          className="absolute inset-0 w-full h-full object-cover z-10"
        />
      )}

      {showConnecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <RefreshCw className="w-8 h-8 text-white/50 animate-spin" />
          <p className="text-white/70 text-sm mt-4">{t("cameraViewer.connecting")}</p>
          <p className="text-white/50 text-xs mt-1">{t("cameraViewer.waitingForCamera")}</p>
        </div>
      )}

      {showError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <p className="text-white/70 text-sm">{error}</p>
          <button
            onClick={onRetry}
            className="mt-4 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t("cameraViewer.retry")}
          </button>
        </div>
      )}

      {showWaiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
          <p className="text-white/70 text-sm mt-4">{t("cameraViewer.waitingForStart")}</p>
        </div>
      )}

      {showDisconnectOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
          <VideoOff className="w-10 h-10 text-white/50 mb-2" />
          <p className="text-white/70 text-sm">{t("cameraViewer.cameraNotDetected")}</p>
          <button
            onClick={onRetry}
            className="mt-3 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t("cameraViewer.retry")}
          </button>
        </div>
      )}

      {/* ★ 터치하여 재생: 비디오 데이터가 있지만 재생되지 않을 때 */}
      {showVideo && !isVideoPlaying && isConnected && (
        <TapToPlayOverlay onPlay={handlePlayClick} />
      )}

      {/* LIVE / REC */}
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

      {/* 오디오 레벨 */}
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
              <span className="text-white/40 text-[10px]">{t("cameraViewer.noAudio")}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CameraViewer;
