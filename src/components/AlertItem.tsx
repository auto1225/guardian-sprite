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
    case "intrusion": return AlertTriangle;
    case "location_change": return MapPin;
    case "offline": return Wifi;
    case "low_battery": return Battery;
    case "unauthorized_peripheral": return Usb;
    default: return AlertTriangle;
  }
};

const getAlertBg = (type: LocalAlertType) => {
  switch (type) {
    case "intrusion": return "bg-red-500/80";
    case "location_change": return "bg-blue-500/80";
    case "offline": return "bg-slate-500/80";
    case "low_battery": return "bg-orange-500/80";
    case "unauthorized_peripheral": return "bg-purple-500/80";
    default: return "bg-red-500/80";
  }
};

const AlertItem = ({ alert, onMarkRead }: AlertItemProps) => {
  const Icon = getAlertIcon(alert.alert_type);
  const bgColor = getAlertBg(alert.alert_type);

  return (
    <div
      onClick={() => !alert.is_read && onMarkRead(alert.id)}
      className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all backdrop-blur-md border ${
        alert.is_read
          ? "bg-white/20 border-white/20"
          : "bg-white/50 border-white/40 shadow-lg shadow-sky-100/30"
      }`}
    >
      <div className={`w-9 h-9 ${bgColor} rounded-full flex items-center justify-center flex-shrink-0 backdrop-blur-sm shadow-sm`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`font-bold text-sm truncate ${alert.is_read ? "text-slate-400" : "text-slate-800"}`}>
            {alert.title}
          </h4>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: ko })}
            </span>
            {!alert.is_read && <span className="w-2 h-2 bg-sky-400 rounded-full shadow-sm shadow-sky-300" />}
          </span>
        </div>
        {alert.message && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">{alert.message}</p>
        )}
      </div>
    </div>
  );
};

export default AlertItem;
