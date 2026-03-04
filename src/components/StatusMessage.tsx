import { Database } from "@/integrations/supabase/types";
import { useTranslation } from "react-i18next";

type DeviceStatus = Database["public"]["Enums"]["device_status"];

interface StatusMessageProps {
  deviceName: string;
  isMonitoring: boolean;
  status?: DeviceStatus;
}

const StatusMessage = ({ deviceName, isMonitoring, status }: StatusMessageProps) => {
  const { t } = useTranslation();

  const getMessage = () => {
    if (status === "alert") return t("status.alertMessage");
    if (!isMonitoring) return t("status.readyMessage");
    return t("status.monitoringMessage");
  };

  return (
    <div className="mx-4 mt-1">
      <div className={`rounded-xl px-5 py-3 shadow-lg ${
        status === "alert" ? "bg-destructive" : "bg-card/95"
      }`}>
        <p className={`text-center font-extrabold text-lg leading-snug ${
          status === "alert" ? "text-destructive-foreground" : "text-card-foreground"
        }`}>
          {getMessage()}
        </p>
      </div>
    </div>
  );
};

export default StatusMessage;