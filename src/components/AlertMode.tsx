import { useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { ActiveAlert } from "@/hooks/useAlerts";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface AlertModeProps {
  device: Device;
  activeAlert: ActiveAlert;
  onDismiss: () => void;
}

const AlertMode = ({ device, activeAlert, onDismiss }: AlertModeProps) => {
  const { toast } = useToast();
  const [capturedImages] = useState<string[]>([]);
  const [showPinPad, setShowPinPad] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const getStoredPin = (): string => {
    const meta = device.metadata as Record<string, unknown> | null;
    return (meta?.alarm_pin as string) || "1234";
  };

  const handleDismissRequest = () => {
    const storedPin = getStoredPin();
    if (storedPin) {
      setShowPinPad(true);
      setPinInput("");
      setPinError(false);
    } else {
      onDismiss();
    }
  };

  const handlePinSubmit = () => {
    const storedPin = getStoredPin();
    if (pinInput === storedPin) {
      toast({ title: "경보 해제", description: "경보가 해제되었습니다." });
      onDismiss();
    } else {
      setPinError(true);
      setPinInput("");
      setTimeout(() => setPinError(false), 1500);
    }
  };

  const handlePinKey = (key: string | number) => {
    if (key === "del") {
      setPinInput(prev => prev.slice(0, -1));
    } else if (pinInput.length < 4) {
      const next = pinInput + key;
      setPinInput(next);
      // 4자리 입력 완료 시 자동 확인
      if (next.length === 4) {
        setTimeout(() => {
          const storedPin = getStoredPin();
          if (next === storedPin) {
            toast({ title: "경보 해제", description: "경보가 해제되었습니다." });
            onDismiss();
          } else {
            setPinError(true);
            setPinInput("");
            setTimeout(() => setPinError(false), 1500);
          }
        }, 100);
      }
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

      {showPinPad ? (
        /* PIN Pad */
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <p className="text-destructive-foreground font-bold text-lg mb-6">비밀번호를 입력하세요</p>
          
          {/* PIN dots */}
          <div className="flex gap-3 mb-8">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                  pinError
                    ? "border-destructive-foreground bg-destructive-foreground/30 animate-pulse"
                    : pinInput[i]
                    ? "border-destructive-foreground bg-destructive-foreground/20"
                    : "border-destructive-foreground/40"
                } text-destructive-foreground`}
              >
                {pinInput[i] ? "•" : ""}
              </div>
            ))}
          </div>

          {pinError && (
            <p className="text-destructive-foreground/80 text-sm mb-4">비밀번호가 틀렸습니다</p>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3 w-64">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((num, i) => (
              <button
                key={i}
                onClick={() => num !== null && handlePinKey(num)}
                disabled={num === null}
                className={`h-14 rounded-xl text-xl font-bold transition-all ${
                  num === null
                    ? "invisible"
                    : "bg-destructive-foreground/15 text-destructive-foreground active:bg-destructive-foreground/30 active:scale-95"
                }`}
              >
                {num === "del" ? "⌫" : num}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowPinPad(false)}
            className="mt-6 text-destructive-foreground/60 text-sm underline"
          >
            뒤로
          </button>
        </div>
      ) : (
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

          {/* Stop button */}
          <div className="p-6">
            <button
              onClick={handleDismissRequest}
              className="w-full py-4 bg-destructive-foreground text-destructive rounded-full font-bold text-lg shadow-lg active:scale-95 transition-transform"
            >
              경보 해제
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AlertMode;
