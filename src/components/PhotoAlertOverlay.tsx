import { useState, useCallback } from "react";
import { PhotoAlert } from "@/lib/photoAlertStorage";
import { stopAlertSound } from "@/hooks/useAlerts";
import * as Alarm from "@/lib/alarmSound";
import { X, Download, ChevronLeft, ChevronRight, ZoomIn, CheckSquare, Square } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { saveSinglePhoto, savePhotos } from "@/lib/photoDownload";
import { useToast } from "@/hooks/use-toast";
import AlertStreamingViewer from "@/components/alert/AlertStreamingViewer";
import AlertLocationMap from "@/components/alert/AlertLocationMap";

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
  const { toast } = useToast();
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "slide">("grid");
  const [slideIndex, setSlideIndex] = useState(0);
  const [phoneDismissed, setPhoneDismissed] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const eventLabel = EVENT_LABELS[alert.event_type] || alert.event_type;
  const createdDate = new Date(alert.created_at);

  const toggleSelect = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIndices.size === alert.photos.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(alert.photos.map((_, i) => i)));
    }
  }, [selectedIndices.size, alert.photos]);

  const handleSaveSelected = useCallback(async () => {
    if (selectedIndices.size === 0) {
      toast({ title: "선택된 사진이 없습니다", description: "저장할 사진을 선택해주세요." });
      return;
    }
    setSaving(true);
    try {
      await savePhotos(alert.photos, alert.event_type, Array.from(selectedIndices));
      toast({ title: "저장 완료", description: `${selectedIndices.size}장 저장됨` });
    } catch {
      toast({ title: "저장 실패", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [selectedIndices, alert, toast]);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await savePhotos(alert.photos, alert.event_type);
      toast({ title: "저장 완료", description: `${alert.photos.length}장 저장됨` });
    } catch {
      toast({ title: "저장 실패", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [alert, toast]);

  const handleSaveSingle = useCallback(async (dataUrl: string, index: number) => {
    setSaving(true);
    try {
      await saveSinglePhoto(dataUrl, `meercop-${alert.event_type}_${index + 1}.jpg`);
    } catch {
      toast({ title: "저장 실패", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [alert.event_type, toast]);

  // Fullscreen viewer
  if (fullscreenIndex !== null) {
    return (
      <div className="fixed inset-0 bg-red-950/90 backdrop-blur-2xl z-[60] flex flex-col">
        <div className="flex items-center justify-between p-4">
          <span className="text-white/90 text-sm">
            {fullscreenIndex + 1} / {alert.photos.length}
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => handleSaveSingle(alert.photos[fullscreenIndex], fullscreenIndex)}
              className="text-white/70 active:text-white"
              disabled={saving}
            >
              <Download size={22} />
            </button>
            <button
              onClick={() => setFullscreenIndex(null)}
              className="text-white/70 active:text-white"
            >
              <X size={22} />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center relative">
          {fullscreenIndex > 0 && (
            <button
              onClick={() => setFullscreenIndex(fullscreenIndex - 1)}
              className="absolute left-2 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-full p-2 text-white"
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
              className="absolute right-2 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-full p-2 text-white"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-red-800/60 backdrop-blur-2xl z-50 flex flex-col overflow-hidden">
      {/* Header - fixed */}
      <div className="flex items-center justify-between p-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-xl">🚨 보안 경보</span>
        </div>
        <button onClick={onDismiss} className="text-white/70 active:text-white">
          <X size={24} />
        </button>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto alert-glass-scroll">
        {/* Receiving progress */}
        {receiving && (
          <div className="px-4 pb-2">
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-3">
              <p className="text-white text-sm mb-2">사진 수신 중... {progress}%</p>
              <Progress value={progress} className="h-2 bg-white/20" />
            </div>
          </div>
        )}

        {/* Event info */}
        <div className="px-4 pb-3">
          <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl p-4">
            <p className="text-white font-bold text-lg">{eventLabel}</p>
            <p className="text-white/70 text-sm mt-1">
              {createdDate.toLocaleString("ko-KR")}
            </p>
            {alert.event_type === "camera_motion" && alert.change_percent != null && (
              <p className="text-white/80 text-sm mt-1">
                변화율: {alert.change_percent.toFixed(1)}%
              </p>
            )}
            <p className="text-white/70 text-sm mt-1">
              사진 {alert.photos.length}장 수신됨
            </p>
          </div>
        </div>

        {/* 동영상 스트리밍 — 최상단 */}
        {alert.auto_streaming && alert.device_id && (
          <AlertStreamingViewer deviceId={alert.device_id} />
        )}

        {/* 위치 지도 */}
        {alert.latitude != null && alert.longitude != null && (
          <AlertLocationMap latitude={alert.latitude} longitude={alert.longitude} />
        )}

        {/* View mode & save controls */}
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              viewMode === "grid"
                ? "bg-white/25 text-white border-white/40"
                : "bg-white/8 text-white/70 border-white/15"
            }`}
          >
            그리드
          </button>
          <button
            onClick={() => setViewMode("slide")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              viewMode === "slide"
                ? "bg-white/25 text-white border-white/40"
                : "bg-white/8 text-white/70 border-white/15"
            }`}
          >
            슬라이드
          </button>

          <div className="ml-auto flex gap-2">
            {viewMode === "grid" && (
              <button
                onClick={() => {
                  setSelectMode((v) => {
                    if (v) setSelectedIndices(new Set());
                    return !v;
                  });
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border flex items-center gap-1 ${
                  selectMode
                    ? "bg-white/25 text-white border-white/40"
                    : "bg-white/8 text-white/70 border-white/15"
                }`}
              >
                <CheckSquare size={14} /> 선택
              </button>
            )}

            {selectMode && selectedIndices.size > 0 ? (
              <button
                onClick={handleSaveSelected}
                disabled={saving}
                className="px-3 py-1.5 rounded-full text-sm font-medium bg-white/20 text-white border border-white/30 flex items-center gap-1"
              >
                <Download size={14} /> {selectedIndices.size}장 저장
              </button>
            ) : (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                className="px-3 py-1.5 rounded-full text-sm font-medium bg-white/10 text-white/80 border border-white/20 flex items-center gap-1"
              >
                <Download size={14} /> 전체 저장
              </button>
            )}
          </div>
        </div>

        {/* Select all toggle */}
        {selectMode && viewMode === "grid" && (
          <div className="px-4 pb-2">
            <button
              onClick={toggleSelectAll}
              className="text-white/80 text-sm flex items-center gap-1.5"
            >
              {selectedIndices.size === alert.photos.length ? (
                <CheckSquare size={16} className="text-white" />
              ) : (
                <Square size={16} className="text-white/50" />
              )}
              전체 선택 ({selectedIndices.size}/{alert.photos.length})
            </button>
          </div>
        )}

        {/* Photos */}
        <div className="px-4 pb-4">
          {viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-2">
              {alert.photos.map((photo, i) => (
                <div
                  key={i}
                  className={`relative rounded-xl overflow-hidden bg-black/20 border cursor-pointer active:opacity-80 ${
                    selectMode && selectedIndices.has(i)
                      ? "border-white/60 ring-2 ring-white/40"
                      : "border-white/15"
                  }`}
                  onClick={() => {
                    if (selectMode) toggleSelect(i);
                    else setFullscreenIndex(i);
                  }}
                >
                  <img src={photo} alt={`사진 ${i + 1}`} className="w-full aspect-[4/3] object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-2">
                    <span className="text-white/90 text-xs">{i + 1}번</span>
                  </div>
                  {selectMode ? (
                    <div className="absolute top-2 right-2">
                      {selectedIndices.has(i) ? (
                        <CheckSquare size={20} className="text-white" />
                      ) : (
                        <Square size={20} className="text-white/40" />
                      )}
                    </div>
                  ) : (
                    <div className="absolute top-2 right-2">
                      <ZoomIn size={16} className="text-white/60" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="relative flex flex-col" style={{ minHeight: "300px" }}>
              <div className="flex-1 flex items-center justify-center relative">
                {slideIndex > 0 && (
                  <button
                    onClick={() => setSlideIndex(slideIndex - 1)}
                    className="absolute left-0 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-full p-2 text-white"
                  >
                    <ChevronLeft size={20} />
                  </button>
                )}
                <img
                  src={alert.photos[slideIndex]}
                  alt={`사진 ${slideIndex + 1}`}
                  className="max-w-full max-h-full object-contain rounded-xl border border-white/15 cursor-pointer"
                  onClick={() => setFullscreenIndex(slideIndex)}
                />
                {slideIndex < alert.photos.length - 1 && (
                  <button
                    onClick={() => setSlideIndex(slideIndex + 1)}
                    className="absolute right-0 z-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-full p-2 text-white"
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
                      i === slideIndex ? "bg-white" : "bg-white/30"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alarm dismiss buttons - fixed at bottom */}
      <div className="p-4 shrink-0 space-y-3">
        {!phoneDismissed && (
          <button
            onClick={() => {
              stopAlertSound();
              Alarm.addDismissed(alert.id);
              setPhoneDismissed(true);
            }}
            className="w-full py-3 bg-white/12 backdrop-blur-md text-white border border-white/25 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
          >
            🔕 스마트폰 경보음 해제
          </button>
        )}
        {onDismissRemoteAlarm && (
          <button
            onClick={() => {
              stopAlertSound();
              Alarm.addDismissed(alert.id);
              onDismissRemoteAlarm();
              onDismiss();
            }}
            className="w-full py-4 bg-white/20 backdrop-blur-md text-white border border-white/30 rounded-full font-bold text-lg shadow-lg active:scale-95 transition-transform"
          >
            🔇 컴퓨터 경보음 해제 (경보 해제)
          </button>
        )}
      </div>
    </div>
  );
}
