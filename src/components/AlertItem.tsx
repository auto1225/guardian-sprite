import { LocalActivityLog, LocalAlertType } from "@/lib/localActivityLogs";
import { AlertTriangle, MapPin, Wifi, Battery, Usb } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

interface AlertItemProps {
  alert: LocalActivityLog;
  onMarkRead: (id: string) => void;
}

const getAlertIcon = (type: LocalAlertType) => {
  switch (type) {
    case "intrusion":
      return AlertTriangle;
    case "location_change":
      return MapPin;
    case "offline":
      return Wifi;
    case "low_battery":
      return Battery;
    case "unauthorized_peripheral":
      return Usb;
    default:
      return AlertTriangle;
  }
};

const getAlertColor = (type: LocalAlertType) => {
  switch (type) {
    case "intrusion":
      return "bg-destructive";
    case "location_change":
      return "bg-secondary";
    case "offline":
      return "bg-muted-foreground";
    case "low_battery":
      return "bg-orange-500";
    case "unauthorized_peripheral":
      return "bg-purple-500";
    default:
      return "bg-destructive";
  }
};

const AlertItem = ({ alert, onMarkRead }: AlertItemProps) => {
  const Icon = getAlertIcon(alert.alert_type);
  const bgColor = getAlertColor(alert.alert_type);

  return (
    <div
      onClick={() => !alert.is_read && onMarkRead(alert.id)}
      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
        alert.is_read ? "opacity-60" : "bg-card"
      }`}
    >
      <div className={`w-10 h-10 ${bgColor} rounded-full flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h4 className={`font-semibold text-sm ${alert.is_read ? "text-muted-foreground" : "text-card-foreground"}`}>
            {alert.title}
          </h4>
          {!alert.is_read && (
            <span className="w-2 h-2 bg-destructive rounded-full" />
          )}
        </div>
        {alert.message && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {alert.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: ko })}
        </p>
      </div>
    </div>
  );
};

export default AlertItem;
