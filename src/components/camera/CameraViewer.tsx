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
  const [videoKey, setVideoKey] = useState(0); // ★ key 변경 시 <video> DOM 완전 재생성
  const playRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  // 재생 시도 — fire-and-forget, play() 프로미스를 await하지 않음
  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;
    video.muted = true;
    // play()는 모바일에서 hang될 수 있으므로 await하지 않음
    // 재생 성공은 'playing' 이벤트로 감지
    video.play().catch((err) => {
      if (err?.name !== "AbortError") {
        console.warn("[CameraViewer] ⚠️ Play rejected:", err?.message);
      }
    });
  }, []);

  // isMuted prop 변경 시 비디오에 반영
  useEffect(() => {
    if (videoRef.current && isVideoPlaying) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted, isVideoPlaying]);

  // ★ 핵심: remoteStream 변경 시 비디오 연결
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (!remoteStream) {
      console.log("[CameraViewer] Stream cleared, hard-resetting video");
      video.pause();
      video.srcObject = null;
      video.load();
      setIsVideoPlaying(false);
      // ★ videoKey를 증가시켜 다음 스트림 도착 시 <video> DOM을 완전히 새로 생성
      setVideoKey(k => k + 1);
      return;
    }

    console.log("[CameraViewer] 📹 New stream received, setting up video playback (videoKey:", videoKey, ")");

    if (playRetryTimerRef.current) {
      clearTimeout(playRetryTimerRef.current);
      playRetryTimerRef.current = null;
    }

    setIsVideoPlaying(false);

    // ★ 이전에 동작하던 초기화 시퀀스 복원
    video.pause();
    video.srcObject = null;
    video.muted = true;
    video.srcObject = remoteStream;

    let playing = false;

    // ★ 'playing' 이벤트로 재생 성공 감지
    const onPlaying = () => {
      if (playing) return;
      playing = true;
      console.log("[CameraViewer] ✅ Video is playing!");
      setIsVideoPlaying(true);
      video.muted = isMutedRef.current;
    };
    video.addEventListener("playing", onPlaying);

    // play()를 fire-and-forget으로 호출 (hang되어도 OK)
    const firePlay = (source: string) => {
      if (playing) return;
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) return;
      console.log(`[CameraViewer] 🎬 firePlay via: ${source}`);
      v.muted = true;
      v.play().catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[CameraViewer] ⚠️ play() rejected via", source, ":", err?.message);
        }
      });
    };

    // 다양한 타이밍에 play() 시도
    const t1 = setTimeout(() => firePlay("immediate-50ms"), 50);
    
    const onLoadedMetadata = () => firePlay("loadedmetadata");
    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    
    const onCanPlay = () => firePlay("canplay");
    video.addEventListener("canplay", onCanPlay, { once: true });

    // ★ 주기적 재시도: 2초마다 play()를 호출 (playing 이벤트 발생 시 중단)
    const retryInterval = setInterval(() => {
      if (playing) {
        clearInterval(retryInterval);
        return;
      }
      const v = videoRef.current;
      if (!v || v.srcObject !== remoteStream) {
        clearInterval(retryInterval);
        return;
      }
      // readyState 로그 추가 — 디버깅용
      console.log(`[CameraViewer] 🔄 Retry play() — readyState: ${v.readyState}, paused: ${v.paused}, networkState: ${v.networkState}`);
      v.muted = true;
      v.play().catch((err) => {
        if (err?.name !== "AbortError") {
          console.warn("[CameraViewer] ⚠️ retry play() rejected:", err?.message);
        }
      });
    }, 2000);

    // 트랙 unmute 시에도 시도
    const trackCleanups: Array<() => void> = [];
    remoteStream.getTracks().forEach(track => {
      if (track.muted) {
        const onUnmute = () => firePlay("track-unmute");
        track.addEventListener("unmute", onUnmute, { once: true });
        trackCleanups.push(() => track.removeEventListener("unmute", onUnmute));
      }
    });

    return () => {
      clearTimeout(t1);
      clearInterval(retryInterval);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      trackCleanups.forEach(fn => fn());
      if (playRetryTimerRef.current) {
        clearTimeout(playRetryTimerRef.current);
        playRetryTimerRef.current = null;
      }
    };
  }, [remoteStream]);

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
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handlePlayClick = () => attemptPlay();

  // 현재 표시할 상태 결정
  const showConnecting = isConnecting && !isConnected && !remoteStream;
  const showError = !!error && !isConnected && !remoteStream;
  const showVideo = !!remoteStream;
  const showWaiting = !showConnecting && !showError && !showVideo;
  const showDisconnectOverlay = showVideo && !isConnected && !isConnecting;

  return (
    <div className="flex-1 bg-black rounded-xl flex items-center justify-center relative overflow-hidden aspect-video">
      {/* ★ video 요소는 항상 DOM에 존재 — videoRef가 null이 되지 않도록 */}
      <video
        key={videoKey}
        ref={videoRef}
        autoPlay
        playsInline
        muted
        preload="auto"
        className={`w-full h-full object-contain ${showVideo ? "" : "hidden"}`}
        onClick={handlePlayClick}
      />

      {/* Connecting */}
      {showConnecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <RefreshCw className="w-8 h-8 text-white/50 animate-spin" />
          <p className="text-white/70 text-sm mt-4">카메라 연결 중...</p>
          <p className="text-white/50 text-xs mt-1">노트북에서 카메라가 시작될 때까지 대기 중</p>
        </div>
      )}

      {/* Error */}
      {showError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <p className="text-white/70 text-sm">{error}</p>
          <button
            onClick={onRetry}
            className="mt-4 px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2 text-white/70 text-sm hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            다시 시도
          </button>
        </div>
      )}

      {/* Waiting */}
      {showWaiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
          <p className="text-white/70 text-sm mt-4">노트북에서 카메라 시작 대기 중...</p>
        </div>
      )}

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
      {showVideo && !isVideoPlaying && isConnected && (
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
};

export default CameraViewer;
