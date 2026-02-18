import { useTranslation } from "react-i18next";
import { PhotoAlert } from "@/lib/photoAlertStorage";
import { X, Trash2, ChevronRight, Image, MapPin } from "lucide-react";

interface PhotoAlertHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: PhotoAlert[];
  onViewAlert: (alert: PhotoAlert) => void;
  onDeleteAlert: (alertId: string) => void;
}

export default function PhotoAlertHistory({ isOpen, onClose, alerts, onViewAlert, onDeleteAlert }: PhotoAlertHistoryProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="font-bold text-lg text-foreground">{t("photos.alertHistory")}</h2>
        <button onClick={onClose} className="text-muted-foreground"><X size={24} /></button>
      </div>

      <div className="flex-1 overflow-auto alert-history-scroll">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Image size={48} className="mb-3 opacity-50" />
            <p>{t("photos.noAlerts")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((alert) => {
              const date = new Date(alert.created_at);
              return (
                <div key={alert.id} className="flex items-center gap-3 p-4">
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0 cursor-pointer" onClick={() => onViewAlert(alert)}>
                    {alert.photos[0] ? (
                      <img src={alert.photos[0]} alt={t("photos.thumbnail")} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Image size={24} className="text-muted-foreground" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewAlert(alert)}>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm truncate">
                        {t(`alertEvents.${alert.event_type}`, { defaultValue: alert.event_type })}
                      </p>
                      {!alert.is_read && <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />}
                    </div>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {date.toLocaleString()} · {t("photos.photoCount", { count: alert.photos.length })}
                    </p>
                    {alert.event_type === "camera_motion" && alert.change_percent != null && (
                      <p className="text-muted-foreground text-xs">{t("photos.changeRate", { percent: alert.change_percent.toFixed(1) })}</p>
                    )}
                    {alert.latitude != null && alert.longitude != null && (
                      <p className="text-muted-foreground text-xs flex items-center gap-1 mt-0.5">
                        <MapPin size={10} className="shrink-0" />
                        {t("photos.locationIncluded")}
                        {alert.location_source && alert.location_source !== "gps" && <span className="text-muted-foreground/70">(Wi-Fi/IP)</span>}
                      </p>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteAlert(alert.id); }} className="text-muted-foreground hover:text-destructive p-2 shrink-0">
                    <Trash2 size={18} />
                  </button>
                  <ChevronRight size={18} className="text-muted-foreground shrink-0 cursor-pointer" onClick={() => onViewAlert(alert)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}