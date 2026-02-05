import { Database } from "@/integrations/supabase/types";

type DeviceStatus = Database["public"]["Enums"]["device_status"];

interface StatusMessageProps {
  deviceName: string;
  isMonitoring: boolean;
  status?: DeviceStatus;
}

const StatusMessage = ({ deviceName, isMonitoring, status }: StatusMessageProps) => {
  const getMessage = () => {
    if (status === "alert") {
      return "노트북에 충격이 감지되었습니다!";
    }
    if (!isMonitoring) {
      return "미어캅 감시 준비 완료! 언제든지 감시를 시작할 수 있습니다.";
    }
    return `미어캅이 당신의 노트북을 감시중입니다.`;
  };

  return (
    <div className="mx-4 mt-2">
      <div className={`rounded-2xl px-5 py-3 shadow-lg ${
        status === "alert" 
          ? "bg-destructive" 
          : "bg-card/95"
      }`}>
        <p className={`text-center font-medium text-sm ${
          status === "alert" 
            ? "text-destructive-foreground" 
            : "text-card-foreground"
        }`}>
          {getMessage()}
        </p>
      </div>
    </div>
  );
};

export default StatusMessage;