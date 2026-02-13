import { useState, useMemo } from "react";
import { Bell, Image, Trash2, CheckCheck } from "lucide-react";
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

type FilterType = "all" | "photo" | "activity";

const AlertPanel = ({ deviceId, onViewPhoto }: AlertPanelProps) => {
  const { alerts: activityAlerts, unreadCount: activityUnread, markAsRead, markAllAsRead } = useAlerts(deviceId);
  const { devices } = useDevices();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");

  const photoAlerts = useMemo(() => {
    void refreshKey;
    return getPhotoAlerts(deviceId || undefined);
  }, [deviceId, refreshKey, isOpen]);

  const photoUnread = photoAlerts.filter(a => !a.is_read).length;
  const totalUnread = activityUnread + photoUnread;

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

    let merged = [...fromActivity, ...fromPhoto];
    if (filter === "photo") merged = merged.filter(a => a.type === "photo");
    if (filter === "activity") merged = merged.filter(a => a.type === "activity");

    return merged.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [activityAlerts, photoAlerts, devices, filter]);

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

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "photo", label: "📸 사진" },
    { key: "activity", label: "🔔 경보" },
  ];

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
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col border-none" style={{ background: 'linear-gradient(180deg, hsla(200, 70%, 55%, 0.85) 0%, hsla(200, 60%, 45%, 0.9) 100%)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        {/* Header */}
        <SheetHeader className="p-4 pb-3 border-b border-white/20">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold text-white">경보 이력</SheetTitle>
            {totalUnread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-sm font-medium"
                style={{ color: 'hsla(52, 100%, 60%, 1)' }}
              >
                <CheckCheck className="w-4 h-4" />
                모두 읽음
              </button>
            )}
          </div>
        </SheetHeader>

        {/* Filter tabs */}
        <div className="flex gap-2 px-4 py-3 border-b border-white/15">
          {filterButtons.map(fb => (
            <button
              key={fb.key}
              onClick={() => setFilter(fb.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === fb.key
                  ? "text-slate-800 shadow-sm"
                  : "text-white/80 hover:bg-white/15"
              }`}
              style={filter === fb.key ? { background: 'hsla(52, 100%, 60%, 0.9)' } : { background: 'hsla(0, 0%, 100%, 0.1)' }}
            >
              {fb.label}
            </button>
          ))}
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 alert-history-scroll">
          {unifiedAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/50">
              <Bell className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-semibold text-white/70">경보 이력이 없습니다</p>
            </div>
          ) : (
            unifiedAlerts.map((alert) => (
              <div key={alert.id}>
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

function PhotoAlertItem({ alert, onView, onDelete }: { alert: UnifiedAlert; onView: () => void; onDelete: () => void }) {
  const photo = alert.photoAlert;
  const thumbnail = photo?.photos?.[0];

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl transition-all border ${
        alert.is_read
          ? "bg-white/10 border-white/10"
          : "bg-white/20 border-white/25 shadow-lg shadow-black/5"
      }`}
      style={{ backdropFilter: 'blur(12px)' }}
    >
      {/* Thumbnail */}
      <button
        onClick={onView}
        className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center border border-white/25"
        style={{ background: 'hsla(0,0%,100%,0.15)' }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="캡처" className="w-full h-full object-cover" />
        ) : (
          <Image className="w-5 h-5 text-white/50" />
        )}
      </button>

      {/* Content */}
      <button onClick={onView} className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`font-bold text-sm truncate ${alert.is_read ? "text-white/70" : "text-white"}`}>
            {alert.title}
          </h4>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-white/70 whitespace-nowrap font-medium">
              {new Date(alert.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            {!alert.is_read && <span className="w-2 h-2 rounded-full" style={{ background: 'hsla(52, 100%, 60%, 1)', boxShadow: '0 0 6px hsla(52, 100%, 60%, 0.5)' }} />}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {alert.device_name && (
            <span className="text-xs text-white/80 font-medium">{alert.device_name}</span>
          )}
          {alert.device_name && alert.message && <span className="text-xs text-white/50">·</span>}
          {alert.message && (
            <span className="text-xs text-white/80 truncate font-medium">{alert.message}</span>
          )}
        </div>
      </button>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-1 text-white/50 hover:text-red-300 transition-colors flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default AlertPanel;
