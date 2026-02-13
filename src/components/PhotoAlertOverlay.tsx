import { useState } from "react";
import { PhotoAlert } from "@/lib/photoAlertStorage";
import { stopAlertSound } from "@/hooks/useAlerts";
import * as Alarm from "@/lib/alarmSound";
import { X, Download, ChevronLeft, ChevronRight, Maximize2, ZoomIn } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const EVENT_LABELS: Record<string, string> = {
  camera_motion: "카메라 움직임 감지",
  keyboard: "키보드 입력 감지",
  mouse: "마우스 입력 감지",
  lid: "덮개 열림 감지",
  power: "전원 변경 감지",
};

interface PhotoAlertOverlayProps {
  alert: PhotoAlert;
  onDismiss: () => void;
  receiving?: boolean;
  progress?: number;
  onDismissRemoteAlarm?: () => void;
  remoteAlarmDismissed?: boolean;
}

export default function PhotoAlertOverlay({
  alert,
  onDismiss,
  receiving,
  progress = 0,
  onDismissRemoteAlarm,
  remoteAlarmDismissed,
}: PhotoAlertOverlayProps) {
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "slide">("grid");
  const [slideIndex, setSlideIndex] = useState(0);
  const [phoneDismissed, setPhoneDismissed] = useState(false);

  const eventLabel = EVENT_LABELS[alert.event_type] || alert.event_type;
  const createdDate = new Date(alert.created_at);

  const downloadPhoto = (dataUrl: string, index: number) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `meercop_${alert.event_type}_${index + 1}.jpg`;
    link.click();
  };

  const downloadAll = () => {
    alert.photos.forEach((photo, i) => {
      setTimeout(() => downloadPhoto(photo, i), i * 200);
    });
  };

  // Fullscreen viewer
  if (fullscreenIndex !== null) {
    return (
      <div className="fixed inset-0 bg-black z-[60] flex flex-col">
        <div className="flex items-center justify-between p-4">
          <span className="text-white text-sm">
            {fullscreenIndex + 1} / {alert.photos.length}
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => downloadPhoto(alert.photos[fullscreenIndex], fullscreenIndex)}
              className="text-white/80 active:text-white"
            >
              <Download size={22} />
            </button>
            <button
              onClick={() => setFullscreenIndex(null)}
              className="text-white/80 active:text-white"
            >
              <X size={22} />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center relative">
          {fullscreenIndex > 0 && (
            <button
              onClick={() => setFullscreenIndex(fullscreenIndex - 1)}
              className="absolute left-2 z-10 bg-black/50 rounded-full p-2 text-white"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <img
            src={alert.photos[fullscreenIndex]}
            alt={`사진 ${fullscreenIndex + 1}`}
            className="max-w-full max-h-full object-contain"
          />
          {fullscreenIndex < alert.photos.length - 1 && (
            <button
              onClick={() => setFullscreenIndex(fullscreenIndex + 1)}
              className="absolute right-2 z-10 bg-black/50 rounded-full p-2 text-white"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-destructive z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-destructive-foreground font-black text-xl">🚨 보안 경보</span>
        </div>
        <button onClick={onDismiss} className="text-destructive-foreground/80 active:text-destructive-foreground">
          <X size={24} />
        </button>
      </div>

      {/* Receiving progress */}
      {receiving && (
        <div className="px-4 pb-2 shrink-0">
          <div className="bg-destructive-foreground/20 rounded-lg p-3">
            <p className="text-destructive-foreground text-sm mb-2">사진 수신 중... {progress}%</p>
            <Progress value={progress} className="h-2 bg-destructive-foreground/30" />
          </div>
        </div>
      )}

      {/* Event info */}
      <div className="px-4 pb-3 shrink-0">
        <div className="bg-destructive-foreground/20 rounded-xl p-4">
          <p className="text-destructive-foreground font-bold text-lg">{eventLabel}</p>
          <p className="text-destructive-foreground/80 text-sm mt-1">
            {createdDate.toLocaleString("ko-KR")}
          </p>
          {alert.event_type === "camera_motion" && alert.change_percent != null && (
            <p className="text-destructive-foreground/90 text-sm mt-1">
              변화율: {alert.change_percent.toFixed(1)}%
            </p>
          )}
          <p className="text-destructive-foreground/80 text-sm mt-1">
            사진 {alert.photos.length}장 수신됨
          </p>
        </div>
      </div>

      {/* View mode toggle */}
      <div className="flex gap-2 px-4 pb-2 shrink-0">
        <button
          onClick={() => setViewMode("grid")}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            viewMode === "grid"
              ? "bg-destructive-foreground text-destructive"
              : "bg-destructive-foreground/20 text-destructive-foreground"
          }`}
        >
          그리드
        </button>
        <button
          onClick={() => setViewMode("slide")}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            viewMode === "slide"
              ? "bg-destructive-foreground text-destructive"
              : "bg-destructive-foreground/20 text-destructive-foreground"
          }`}
        >
          슬라이드
        </button>
        <button
          onClick={downloadAll}
          className="ml-auto px-3 py-1.5 rounded-full text-sm font-medium bg-destructive-foreground/20 text-destructive-foreground flex items-center gap-1"
        >
          <Download size={14} /> 전체 저장
        </button>
      </div>

      {/* Photos */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-2">
            {alert.photos.map((photo, i) => (
              <div
                key={i}
                className="relative rounded-lg overflow-hidden bg-black/30 cursor-pointer active:opacity-80"
                onClick={() => setFullscreenIndex(i)}
              >
                <img src={photo} alt={`사진 ${i + 1}`} className="w-full aspect-[4/3] object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <span className="text-white text-xs">{i + 1}번</span>
                </div>
                <div className="absolute top-2 right-2">
                  <ZoomIn size={16} className="text-white/70" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="relative h-full flex flex-col">
            <div className="flex-1 flex items-center justify-center relative">
              {slideIndex > 0 && (
                <button
                  onClick={() => setSlideIndex(slideIndex - 1)}
                  className="absolute left-0 z-10 bg-black/40 rounded-full p-2 text-white"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <img
                src={alert.photos[slideIndex]}
                alt={`사진 ${slideIndex + 1}`}
                className="max-w-full max-h-full object-contain rounded-lg cursor-pointer"
                onClick={() => setFullscreenIndex(slideIndex)}
              />
              {slideIndex < alert.photos.length - 1 && (
                <button
                  onClick={() => setSlideIndex(slideIndex + 1)}
                  className="absolute right-0 z-10 bg-black/40 rounded-full p-2 text-white"
                >
                  <ChevronRight size={20} />
                </button>
              )}
            </div>
            <div className="flex justify-center gap-1.5 pt-3">
              {alert.photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlideIndex(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === slideIndex ? "bg-destructive-foreground" : "bg-destructive-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Alarm dismiss buttons */}
      <div className="p-4 shrink-0 space-y-3">
        {!phoneDismissed && (
          <button
            onClick={() => {
              stopAlertSound();
              setPhoneDismissed(true);
            }}
            className="w-full py-3 bg-destructive-foreground/20 text-destructive-foreground border-2 border-destructive-foreground/40 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
          >
            🔕 스마트폰 경보음 해제
          </button>
        )}
        {onDismissRemoteAlarm && (
          <button
            onClick={() => {
              // 컴퓨터 경보음 해제 = 전체 경보해제 → 스마트폰 경보음도 해제 + 오버레이 닫기
              stopAlertSound();
              Alarm.addDismissed(alert.id);
              onDismissRemoteAlarm();
              onDismiss();
            }}
            className="w-full py-4 bg-destructive-foreground text-destructive rounded-full font-bold text-lg shadow-lg active:scale-95 transition-transform"
          >
            🔇 컴퓨터 경보음 해제 (경보 해제)
          </button>
        )}
      </div>
    </div>
  );
}
