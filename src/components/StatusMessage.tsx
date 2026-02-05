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
      return "스마트폰에서 감시를 ON 해 주세요.";
    }
    return `미어캅이 당신의 노트북을 감시중입니다.`;
  };

  return (
    <div className="mx-6 mt-4">
      <div className={`rounded-2xl px-6 py-4 shadow-lg ${
        status === "alert" 
          ? "bg-destructive" 
          : "bg-card/95"
      }`}>
        <p className={`text-center font-medium ${
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