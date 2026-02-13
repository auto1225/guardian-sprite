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

const getAlertIconBg = (type: LocalAlertType) => {
  switch (type) {
    case "intrusion": return "hsla(0, 70%, 55%, 0.7)";
    case "location_change": return "hsla(210, 70%, 55%, 0.7)";
    case "offline": return "hsla(210, 15%, 50%, 0.7)";
    case "low_battery": return "hsla(30, 80%, 55%, 0.7)";
    case "unauthorized_peripheral": return "hsla(270, 60%, 55%, 0.7)";
    default: return "hsla(0, 70%, 55%, 0.7)";
  }
};

const AlertItem = ({ alert, onMarkRead }: AlertItemProps) => {
  const Icon = getAlertIcon(alert.alert_type);
  const iconBg = getAlertIconBg(alert.alert_type);

  return (
    <div
      onClick={() => !alert.is_read && onMarkRead(alert.id)}
      className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border ${
        alert.is_read
          ? "bg-white/10 border-white/10"
          : "bg-white/20 border-white/25 shadow-lg shadow-black/5"
      }`}
      style={{ backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: iconBg }}
      >
        <Icon className="w-4 h-4 text-white" />
      </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`font-bold text-sm truncate ${alert.is_read ? "text-white/70" : "text-white"}`}>
              {alert.title}
            </h4>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] text-white/70 whitespace-nowrap font-medium">
                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: ko })}
              </span>
              {!alert.is_read && <span className="w-2 h-2 rounded-full" style={{ background: 'hsla(52, 100%, 60%, 1)', boxShadow: '0 0 6px hsla(52, 100%, 60%, 0.5)' }} />}
            </span>
          </div>
          {alert.message && (
            <p className="text-xs text-white/80 mt-0.5 truncate font-medium">{alert.message}</p>
        )}
      </div>
    </div>
  );
};

export default AlertItem;
