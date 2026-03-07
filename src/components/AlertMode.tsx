import { useState, useEffect } from "react";
import { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { ActiveAlert, stopAlertSound } from "@/hooks/useAlerts";
import * as Alarm from "@/lib/alarmSound";
import { Video, VideoOff, MapPin, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AlertStreamingViewer from "@/components/alert/AlertStreamingViewer";
import AlertLocationMap from "@/components/alert/AlertLocationMap";
import { useAlertLocation } from "@/hooks/useAlertLocation";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface AlertModeProps {
  device: Device;
  activeAlert: ActiveAlert;
  onDismiss: () => void;
  onSendRemoteAlarmOff?: () => Promise<void>;
  /** 경보 발생 시점에 캡처된 기기명 — 리렌더에도 불변 */
  alertDeviceName: string;
  /** 경보 발생 시점에 캡처된 시리얼 — 리렌더에도 불변 */
  alertDeviceSerial: string | null;
}

const AlertMode = ({ device, activeAlert, onDismiss, onSendRemoteAlarmOff, alertDeviceName, alertDeviceSerial }: AlertModeProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [phoneDismissed, setPhoneDismissed] = useState(false);

  // ★ 기기명을 state로 frozen — ref와 달리 초기 빈 값→유효 값 전환 시 리렌더 발생
  const [frozenName, setFrozenName] = useState(alertDeviceName || device?.name || "");
  const [frozenSerial, setFrozenSerial] = useState(alertDeviceSerial);
  useEffect(() => {
    if (!frozenName && alertDeviceName) setFrozenName(alertDeviceName);
    if (!frozenName && device?.name) setFrozenName(device.name);
  }, [alertDeviceName, device?.name, frozenName]);
  useEffect(() => {
    if (!frozenSerial && alertDeviceSerial) setFrozenSerial(alertDeviceSerial);
  }, [alertDeviceSerial, frozenSerial]);
  const displayName = frozenName || device?.name || "Unknown";
  const displaySerial = frozenSerial;

  const handleDismissRemoteAlarm = async () => {
    stopAlertSound();
    Alarm.addDismissed(activeAlert.id);
    Alarm.suppressFor(5000);
    
    try {
      if (onSendRemoteAlarmOff) {
        await onSendRemoteAlarmOff();
      }
      toast({ title: t("alarm.allDismissed"), description: t("alarm.allDismissedDesc") });
    } catch (err) {
      console.error("[AlertMode] remote_alarm_off failed:", err);
      toast({ title: t("common.error"), description: t("alarm.computerAlarmDismissFailed"), variant: "destructive" });
    }
    
    onDismiss();
  };

  const handleForceClose = () => {
    stopAlertSound();
    Alarm.addDismissed(activeAlert.id);
    Alarm.suppressFor(5000);
    onDismiss();
  };

  const hasCamera = device?.is_camera_connected;

  // 위치 정보 신뢰성 강화 — 폴링 + DB fallback
  const alertLocation = useAlertLocation(
    device?.id,
    device?.latitude,
    device?.longitude,
    true
  );
  const hasLocation = alertLocation != null;

  return (
    <div className="fixed inset-0 bg-red-800/60 backdrop-blur-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 shrink-0">
        <span className="text-white font-black text-xl">{t("alert.securityAlert")}</span>
        <button
          onClick={handleForceClose}
          className="text-white/70 text-sm font-bold px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 shrink-0"
        >
          ✕
        </button>
      </div>

      {/* ★ 기기명 + 경보 카드 — 스크롤 영역 밖 고정 (덮이지 않음) */}
      <div className="px-4 pb-3 shrink-0 relative z-[500] shadow-lg">
        <div className="bg-white/15 backdrop-blur-md border border-white/20 rounded-xl p-3 shadow-lg">
          {/* 기기명 + 시리얼 */}
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
            <span className="text-yellow-200 font-black text-base leading-tight">{displayName}</span>
            {displaySerial && (
              <span className="text-yellow-200/60 text-[10px] font-mono">({displaySerial})</span>
            )}
          </div>
          {/* 경보 내용 */}
          <p className="text-white font-bold text-sm">{activeAlert.title}</p>
          {activeAlert.message && (
            <p className="text-white/70 text-xs mt-0.5">{activeAlert.message}</p>
          )}
          <p className="text-white/70 text-[11px] mt-0.5">
            {new Date(activeAlert.created_at).toLocaleString("ko-KR")}
          </p>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto alert-glass-scroll relative z-0" style={{ contain: 'strict', overflowY: 'auto' }}>

        {/* 실시간 스트리밍 */}
        {hasCamera && device ? (
          <AlertStreamingViewer deviceId={device.id} alertId={activeAlert.id} />
        ) : (
          <div className="mx-4 mb-3">
            <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <Video size={16} className="text-white/80" />
                <span className="text-white font-bold text-sm">{t("alert.liveStreaming")}</span>
              </div>
              <div className="relative aspect-video bg-black/40 flex flex-col items-center justify-center">
                <VideoOff className="w-8 h-8 text-white/40 mb-2" />
                <span className="text-sm text-white/60">{t("alert.cameraNotDetected")}</span>
              </div>
            </div>
          </div>
        )}

        {/* 위치 지도 */}
        {hasLocation && alertLocation ? (
          <AlertLocationMap
            latitude={alertLocation.latitude}
            longitude={alertLocation.longitude}
            locationSource={alertLocation.locationSource}
          />
        ) : !hasLocation && alertLocation === null ? (
          <div className="mx-4 mb-3 shrink-0">
            <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <MapPin size={16} className="text-white/80" />
                <span className="text-white font-bold text-sm">{t("alert.laptopLocation")}</span>
              </div>
              <div className="h-48 bg-black/40 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 text-white/40 mb-2 animate-spin" />
                <span className="text-sm text-white/60">{t("alertLocation.loadingAddress", "위치 정보 확인 중...")}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-4 mb-3 shrink-0">
            <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <MapPin size={16} className="text-white/80" />
                <span className="text-white font-bold text-sm">{t("alert.laptopLocation")}</span>
              </div>
              <div className="h-48 bg-black/40 flex flex-col items-center justify-center">
                <MapPin className="w-8 h-8 text-white/40 mb-2" />
                <span className="text-sm text-white/60">{t("alert.noLocationInfo")}</span>
              </div>
            </div>
          </div>
        )}

        {/* 캡처 사진 — 사진 없음 표시 */}
        <div className="px-4 pb-4">
          <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
              <VideoOff size={16} className="text-white/80" />
              <span className="text-white font-bold text-sm">{t("alert.capturedPhotos")}</span>
            </div>
            <div className="aspect-[4/3] bg-black/40 flex flex-col items-center justify-center">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">{t("alert.noPhotoData")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons - fixed at bottom */}
      <div className="p-4 shrink-0 space-y-3">
        {!phoneDismissed && (
          <button
            onClick={() => {
              stopAlertSound();
              Alarm.addDismissed(activeAlert.id);
              Alarm.suppressFor(5000);
              setPhoneDismissed(true);
              toast({ title: t("alarm.phoneAlarmDismissed"), description: t("alarm.phoneAlarmDismissedDesc") });
            }}
            className="w-full py-3 bg-white/12 backdrop-blur-md text-white border border-white/25 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
          >
            {t("alarm.dismissPhoneAlarm")}
          </button>
        )}
        <button
          onClick={handleDismissRemoteAlarm}
          className="w-full py-3 bg-white/20 backdrop-blur-md text-white border border-white/30 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
        >
          {t("alarm.dismissComputerAlarm")}
        </button>
      </div>
    </div>
  );
};

export default AlertMode;