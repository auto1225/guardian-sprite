import { useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { ActiveAlert, stopAlertSound } from "@/hooks/useAlerts";
import * as Alarm from "@/lib/alarmSound";
import { Video, VideoOff, MapPin } from "lucide-react";
import AlertStreamingViewer from "@/components/alert/AlertStreamingViewer";
import AlertLocationMap from "@/components/alert/AlertLocationMap";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface AlertModeProps {
  device: Device;
  activeAlert: ActiveAlert;
  onDismiss: () => void;
  onSendRemoteAlarmOff?: () => Promise<void>;
}

const AlertMode = ({ device, activeAlert, onDismiss, onSendRemoteAlarmOff }: AlertModeProps) => {
  const { toast } = useToast();
  const [phoneDismissed, setPhoneDismissed] = useState(false);

  const handleDismissRemoteAlarm = async () => {
    try {
      if (onSendRemoteAlarmOff) {
        await onSendRemoteAlarmOff();
      }
      stopAlertSound();
      Alarm.addDismissed(activeAlert.id);
      toast({ title: "경보 해제", description: "컴퓨터와 스마트폰의 경보가 모두 해제되었습니다." });
      onDismiss();
    } catch (err) {
      console.error("[AlertMode] remote_alarm_off failed:", err);
      toast({ title: "오류", description: "컴퓨터 경보 해제에 실패했습니다.", variant: "destructive" });
    }
  };

  const hasCamera = device?.is_camera_connected;
  const hasLocation = device?.latitude != null && device?.longitude != null;

  return (
    <div className="fixed inset-0 bg-red-800/60 backdrop-blur-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-xl">🚨 보안 경보</span>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto alert-glass-scroll">
        {/* Alert message */}
        <div className="px-4 pb-3">
          <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl p-4">
            <p className="text-white font-bold text-lg">{activeAlert.title}</p>
            {activeAlert.message && (
              <p className="text-white/70 text-sm mt-1">{activeAlert.message}</p>
            )}
            <p className="text-white/70 text-sm mt-1">
              {new Date(activeAlert.created_at).toLocaleString("ko-KR")}
            </p>
          </div>
        </div>

        {/* 실시간 스트리밍 */}
        {hasCamera && device ? (
          <AlertStreamingViewer deviceId={device.id} alertId={activeAlert.id} />
        ) : (
          <div className="mx-4 mb-3">
            <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <Video size={16} className="text-white/80" />
                <span className="text-white font-bold text-sm">🎥 실시간 스트리밍</span>
              </div>
              <div className="relative aspect-video bg-black/40 flex flex-col items-center justify-center">
                <VideoOff className="w-8 h-8 text-white/40 mb-2" />
                <span className="text-sm text-white/60">카메라가 인식되지 않습니다</span>
              </div>
            </div>
          </div>
        )}

        {/* 위치 지도 */}
        {hasLocation ? (
          <AlertLocationMap latitude={device.latitude!} longitude={device.longitude!} locationSource={undefined} />
        ) : (
          <div className="mx-4 mb-3 shrink-0">
            <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
                <MapPin size={16} className="text-white/80" />
                <span className="text-white font-bold text-sm">📍 노트북 위치</span>
              </div>
              <div className="h-48 bg-black/40 flex flex-col items-center justify-center">
                <MapPin className="w-8 h-8 text-white/40 mb-2" />
                <span className="text-sm text-white/60">위치 정보 없음</span>
              </div>
            </div>
          </div>
        )}

        {/* 캡처 사진 — 사진 없음 표시 */}
        <div className="px-4 pb-4">
          <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
              <VideoOff size={16} className="text-white/80" />
              <span className="text-white font-bold text-sm">📷 캡처 사진</span>
            </div>
            <div className="aspect-[4/3] bg-black/40 flex flex-col items-center justify-center">
              <VideoOff className="w-8 h-8 text-white/40 mb-2" />
              <span className="text-sm text-white/60">사진 데이터가 수신되지 않았습니다</span>
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
              setPhoneDismissed(true);
              toast({ title: "스마트폰 경보음 해제", description: "스마트폰의 경보음이 해제되었습니다." });
            }}
            className="w-full py-3 bg-white/12 backdrop-blur-md text-white border border-white/25 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
          >
            🔕 스마트폰 경보음 해제
          </button>
        )}
        <button
          onClick={handleDismissRemoteAlarm}
          className="w-full py-3 bg-white/20 backdrop-blur-md text-white border border-white/30 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
        >
          🔇 컴퓨터 경보음 해제 (경보 해제)
        </button>
      </div>
    </div>
  );
};

export default AlertMode;
