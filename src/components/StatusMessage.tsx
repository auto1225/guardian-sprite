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
      return (
        <>
          아래 미어캅 감시를 <span className="text-primary font-bold">ON</span>해주세요 !
        </>
      );
    }
    return `미어캅이 당신의 노트북을 감시중입니다.`;
  };

  return (
    <div className="mx-4 mt-2">
      <div className={`relative rounded-3xl px-6 py-4 shadow-lg ${
        status === "alert" 
          ? "bg-destructive" 
          : "bg-sky-100"
      }`}>
        <p className={`text-center font-medium text-base ${
          status === "alert" 
            ? "text-destructive-foreground" 
            : "text-gray-700"
        }`}>
          {getMessage()}
        </p>
        {/* Speech bubble tail */}
        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2">
          <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-l-transparent border-r-transparent border-t-sky-100" />
        </div>
      </div>
    </div>
  );
};

export default StatusMessage;