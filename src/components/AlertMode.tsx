import { useEffect, useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { ActiveAlert } from "@/hooks/useAlerts";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface AlertModeProps {
  device: Device;
  activeAlert: ActiveAlert;
  onDismiss: () => void;
}

const AlertMode = ({ device, activeAlert, onDismiss }: AlertModeProps) => {
  const { sendCommand } = useCommands();
  const { toast } = useToast();
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const handleStopAlert = async () => {
    try {
      await sendCommand.mutateAsync({
        deviceId: device.id,
        commandType: "alarm",
        payload: { action: "stop" },
      });
      toast({
        title: "경보 해제",
        description: "노트북의 경보가 해제되었습니다.",
      });
      onDismiss();
    } catch (error) {
      toast({
        title: "오류",
        description: "경보 해제에 실패했습니다.",
        variant: "destructive",
      });
    }
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

        {/* Character or alert animation could go here */}
        <div className="mt-8 w-48 h-48 bg-destructive-foreground/10 rounded-full flex items-center justify-center">
          <span className="text-6xl">🚨</span>
        </div>
      </div>

      {/* Stop button */}
      <div className="p-6">
        <button
          onClick={handleStopAlert}
          className="w-full py-4 bg-destructive-foreground text-destructive rounded-full font-bold text-lg shadow-lg active:scale-95 transition-transform"
        >
          경보 해제
        </button>
      </div>
    </div>
  );
};

export default AlertMode;
