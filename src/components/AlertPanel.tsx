import { useState, useMemo } from "react";
import { Bell, Image, Trash2 } from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import AlertItem from "./AlertItem";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getPhotoAlerts, PhotoAlert, deletePhotoAlert, markPhotoAlertRead } from "@/lib/photoAlertStorage";
import { useDevices } from "@/hooks/useDevices";

interface AlertPanelProps {
  deviceId: string | null;
  onViewPhoto?: (alert: PhotoAlert) => void;
}

interface UnifiedAlert {
  id: string;
  type: "activity" | "photo";
  title: string;
  message: string | null;
  created_at: string;
  is_read: boolean;
  device_name?: string;
  photoAlert?: PhotoAlert;
  activityLog?: ReturnType<typeof useAlerts>["alerts"][0];
}

const AlertPanel = ({ deviceId, onViewPhoto }: AlertPanelProps) => {
  const { alerts: activityAlerts, unreadCount: activityUnread, markAsRead, markAllAsRead } = useAlerts(deviceId);
  const { devices } = useDevices();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const photoAlerts = useMemo(() => {
    // trigger re-read on refreshKey or open
    void refreshKey;
    return getPhotoAlerts(deviceId || undefined);
  }, [deviceId, refreshKey, isOpen]);

  const photoUnread = photoAlerts.filter(a => !a.is_read).length;
  const totalUnread = activityUnread + photoUnread;

  // Merge and sort by time
  const unifiedAlerts = useMemo<UnifiedAlert[]>(() => {
    const fromActivity: UnifiedAlert[] = activityAlerts.map(a => ({
      id: a.id,
      type: "activity" as const,
      title: a.title,
      message: a.message,
      created_at: a.created_at,
      is_read: a.is_read,
      device_name: a.device_name,
      activityLog: a,
    }));

    const getDeviceName = (did: string) => devices.find(d => d.id === did)?.name || "";

    const eventLabel = (type: string) => {
      switch (type) {
        case "camera_motion": return "카메라 움직임 감지";
        case "keyboard": return "키보드 입력 감지";
        case "mouse": return "마우스 입력 감지";
        case "lid": return "노트북 덮개 열림";
        case "power": return "전원 변경 감지";
        default: return "보안 이벤트";
      }
    };

    const fromPhoto: UnifiedAlert[] = photoAlerts.map(a => ({
      id: `photo-${a.id}`,
      type: "photo" as const,
      title: `📸 ${eventLabel(a.event_type)}`,
      message: `사진 ${a.total_photos}장 캡처됨`,
      created_at: a.created_at,
      is_read: a.is_read,
      device_name: getDeviceName(a.device_id),
      photoAlert: a,
    }));

    return [...fromActivity, ...fromPhoto].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [activityAlerts, photoAlerts, devices]);

  const handleMarkAllRead = () => {
    markAllAsRead.mutate();
    photoAlerts.forEach(a => {
      if (!a.is_read) markPhotoAlertRead(a.id);
    });
    setRefreshKey(k => k + 1);
  };

  const handleDeletePhoto = (alertId: string) => {
    deletePhotoAlert(alertId);
    setRefreshKey(k => k + 1);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (open) setRefreshKey(k => k + 1); }}>
      <SheetTrigger asChild>
        <button className="relative p-2 text-primary-foreground">
          <Bell className="w-6 h-6" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">경보 이력</SheetTitle>
            {totalUnread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-sm text-primary hover:underline"
              >
                모두 읽음
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {unifiedAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="w-12 h-12 mb-3 opacity-50" />
              <p>경보 이력이 없습니다</p>
            </div>
          ) : (
            unifiedAlerts.map((alert) => (
              <div key={alert.id} className="relative">
                {alert.type === "photo" && alert.photoAlert ? (
                  <PhotoAlertItem
                    alert={alert}
                    onView={() => {
                      if (alert.photoAlert) {
                        markPhotoAlertRead(alert.photoAlert.id);
                        setRefreshKey(k => k + 1);
                        onViewPhoto?.(alert.photoAlert);
                        setIsOpen(false);
                      }
                    }}
                    onDelete={() => {
                      if (alert.photoAlert) handleDeletePhoto(alert.photoAlert.id);
                    }}
                  />
                ) : alert.activityLog ? (
                  <AlertItem
                    alert={alert.activityLog}
                    onMarkRead={(id) => markAsRead.mutate(id)}
                  />
                ) : null}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// Photo alert list item with thumbnail
function PhotoAlertItem({ alert, onView, onDelete }: { alert: UnifiedAlert; onView: () => void; onDelete: () => void }) {
  const photo = alert.photoAlert;
  const thumbnail = photo?.photos?.[0];

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-all ${
        alert.is_read ? "opacity-60" : "bg-card"
      }`}
    >
      {/* Thumbnail or icon */}
      <button
        onClick={onView}
        className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center border border-border"
      >
        {thumbnail ? (
          <img src={thumbnail} alt="캡처" className="w-full h-full object-cover" />
        ) : (
          <Image className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      <button onClick={onView} className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between">
          <h4 className={`font-semibold text-sm ${alert.is_read ? "text-muted-foreground" : "text-card-foreground"}`}>
            {alert.title}
          </h4>
          {!alert.is_read && (
            <span className="w-2 h-2 bg-destructive rounded-full flex-shrink-0" />
          )}
        </div>
        {alert.device_name && (
          <p className="text-xs text-muted-foreground">{alert.device_name}</p>
        )}
        {alert.message && (
          <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(alert.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      </button>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default AlertPanel;
