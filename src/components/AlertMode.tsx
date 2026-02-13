import { useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { ActiveAlert, stopAlertSound } from "@/hooks/useAlerts";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface AlertModeProps {
  device: Device;
  activeAlert: ActiveAlert;
  onDismiss: () => void;
  onSendRemoteAlarmOff?: () => Promise<void>;
}

const AlertMode = ({ device, activeAlert, onDismiss, onSendRemoteAlarmOff }: AlertModeProps) => {
  const { toast } = useToast();
  const [capturedImages] = useState<string[]>([]);

  // 컴퓨터 경보음 원격 해제
  const handleDismissRemoteAlarm = async () => {
    try {
      if (onSendRemoteAlarmOff) {
        await onSendRemoteAlarmOff();
      }
      toast({ title: "컴퓨터 경보 해제", description: "컴퓨터의 경보음이 해제되었습니다." });
    } catch (err) {
      console.error("[AlertMode] remote_alarm_off failed:", err);
      toast({ title: "오류", description: "컴퓨터 경보 해제에 실패했습니다.", variant: "destructive" });
    }
  };

  // 전체 경보 해제
  const handleDismiss = () => {
    toast({ title: "경보 해제", description: "경보가 해제되었습니다." });
    onDismiss();
  };

  return (
    <div className="fixed inset-0 bg-destructive z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <span className="text-destructive-foreground font-black text-xl italic">Meer</span>
          <span className="text-destructive-foreground font-black text-xl">COP</span>
        </div>
      </div>

      {/* Camera captures */}
      {capturedImages.length > 0 && (
        <div className="flex gap-2 px-4 overflow-x-auto py-2">
          {capturedImages.map((img, index) => (
            <div key={index} className="relative flex-shrink-0">
              <img
                src={img}
                alt={`캡처 ${index + 1}`}
                className="w-24 h-24 object-cover rounded-lg border-2 border-destructive-foreground/50"
              />
              <span className="absolute top-1 left-1 bg-black/50 text-white text-xs px-1 rounded">
                -{index * 1}초
              </span>
            </div>
          ))}
        </div>
      )}

        <>
          {/* Alert message */}
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="bg-destructive-foreground/20 rounded-2xl p-6 text-center max-w-sm">
              <p className="text-destructive-foreground font-bold text-lg">
                {activeAlert.title}
              </p>
              {activeAlert.message && (
                <p className="text-destructive-foreground/80 text-sm mt-2">
                  {activeAlert.message}
                </p>
              )}
            </div>

            <div className="mt-8 w-48 h-48 bg-destructive-foreground/10 rounded-full flex items-center justify-center">
              <span className="text-6xl">🚨</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="p-6 space-y-3">
            <button
              onClick={() => {
                stopAlertSound();
                toast({ title: "스마트폰 경보음 해제", description: "스마트폰의 경보음이 해제되었습니다." });
              }}
              className="w-full py-3 bg-destructive-foreground/20 text-destructive-foreground border-2 border-destructive-foreground/40 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
            >
              🔕 스마트폰 경보음 해제
            </button>
            <button
              onClick={handleDismissRemoteAlarm}
              className="w-full py-3 bg-destructive-foreground/20 text-destructive-foreground border-2 border-destructive-foreground/40 rounded-full font-bold text-base shadow-lg active:scale-95 transition-transform"
            >
              🔇 컴퓨터 경보음 해제
            </button>
          </div>
        </>
    </div>
  );
};

export default AlertMode;
