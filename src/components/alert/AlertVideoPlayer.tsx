import { useEffect, useState, useRef, useCallback } from "react";
import { getAlertVideo } from "@/lib/alertVideoStorage";
import { Video, VideoOff, Play, Pause, Download, Loader2 } from "lucide-react";

interface AlertVideoPlayerProps {
  alertId: string;
}

export default function AlertVideoPlayer({ alertId }: AlertVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mimeType, setMimeType] = useState("video/webm");

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      setLoading(true);
      const result = await getAlertVideo(alertId);
      if (result) {
        url = URL.createObjectURL(result.blob);
        setVideoUrl(url);
        setMimeType(result.mimeType);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [alertId]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    const result = await getAlertVideo(alertId);
    if (!result) return;
    const ext = result.mimeType.includes("mp4") ? "mp4" : "webm";
    const filename = `meercop-alert-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.${ext}`;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [alertId]);

  return (
    <div className="mx-4 mb-3">
      <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <Video size={16} className="text-white/80" />
          <span className="text-white font-bold text-sm">🎬 녹화 영상</span>
        </div>
        <div className="relative aspect-video bg-black/40">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin mb-2" />
              <span className="text-sm text-white/60">영상 로딩 중...</span>
            </div>
          )}
          {notFound && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">저장된 녹화 영상이 없습니다</span>
            </div>
          )}
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain"
              playsInline
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />
          )}
        </div>
        {videoUrl && (
          <div className="flex items-center justify-center gap-3 px-4 py-2.5 border-t border-white/10">
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/25 transition-colors"
              title={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <button
              onClick={handleDownload}
              className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/25 transition-colors"
              title="다운로드"
            >
              <Download size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
