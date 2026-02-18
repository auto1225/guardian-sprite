import { useState, useMemo, useEffect, useCallback } from "react";
import { Bell, Image, Trash2, CheckCheck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Square, CheckSquare, MinusSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import AlertItem from "./AlertItem";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getPhotoAlerts, PhotoAlert, deletePhotoAlert, markPhotoAlertRead } from "@/lib/photoAlertStorage";
import {
  getAlertLogs,
  deleteActivityLogs,
  markLogsAsReadByIds,
  markLogAsRead,
  markAllLogsAsRead,
  LocalActivityLog,
} from "@/lib/localActivityLogs";
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
  activityLog?: LocalActivityLog;
}

type FilterType = "all" | "photo" | "activity";

const ITEMS_PER_PAGE = 10;

const AlertPanel = ({ deviceId, onViewPhoto }: AlertPanelProps) => {
  const { devices } = useDevices();
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Read activity logs directly from localStorage (no Presence subscription)
  const activityAlerts = useMemo(() => {
    void refreshKey;
    void isOpen;
    return getAlertLogs(undefined, 50);
  }, [refreshKey, isOpen]);
  const activityUnread = activityAlerts.filter(a => !a.is_read).length;

  const refreshAlerts = useCallback(() => setRefreshKey(k => k + 1), []);
  const [filter, setFilter] = useState<FilterType>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);

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
        case "camera_motion": return t("alertEvents.camera_motion");
        case "keyboard": return t("alertEvents.keyboard");
        case "mouse": return t("alertEvents.mouse");
        case "lid": return t("alertEvents.lid");
        case "power": return t("alertEvents.power");
        default: return t("alertEvents.camera_motion");
      }
    };

    const fromPhoto: UnifiedAlert[] = photoAlerts.map(a => ({
      id: `photo-${a.id}`,
      type: "photo" as const,
      title: `📸 ${eventLabel(a.event_type)}`,
      message: t("alertPanel.capturedPhotos", { count: a.total_photos }),
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
  }, [activityAlerts, photoAlerts, devices, filter, t]);

  const totalPages = Math.max(1, Math.ceil(unifiedAlerts.length / ITEMS_PER_PAGE));

  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [filter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const pageAlerts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return unifiedAlerts.slice(start, start + ITEMS_PER_PAGE);
  }, [unifiedAlerts, currentPage]);

  useEffect(() => {
    if (!isOpen || pageAlerts.length === 0) return;
    const unreadActivity = pageAlerts.filter(a => !a.is_read && a.type === "activity");
    const unreadPhoto = pageAlerts.filter(a => !a.is_read && a.type === "photo");

    if (unreadActivity.length > 0) {
      markLogsAsReadByIds(unreadActivity.map(a => a.id));
      refreshAlerts();
    }
    if (unreadPhoto.length > 0) {
      unreadPhoto.forEach(a => {
        if (a.photoAlert) markPhotoAlertRead(a.photoAlert.id);
      });
      setRefreshKey(k => k + 1);
    }
  }, [isOpen, currentPage, pageAlerts.length]);

  const handleMarkAllRead = () => {
    markAllLogsAsRead();
    refreshAlerts();
    photoAlerts.forEach(a => {
      if (!a.is_read) markPhotoAlertRead(a.id);
    });
    setRefreshKey(k => k + 1);
  };

  const handleDeletePhoto = (alertId: string) => {
    deletePhotoAlert(alertId);
    setRefreshKey(k => k + 1);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = pageAlerts.map(a => a.id);
    setSelectedIds(new Set(ids));
  };

  const deselectAll = () => setSelectedIds(new Set());

  const allSelected = pageAlerts.length > 0 && pageAlerts.every(a => selectedIds.has(a.id));
  const someSelected = pageAlerts.some(a => selectedIds.has(a.id));

  const handleDeleteSelected = () => {
    const activityIds: string[] = [];
    const photoIds: string[] = [];
    selectedIds.forEach(id => {
      const alert = unifiedAlerts.find(a => a.id === id);
      if (!alert) return;
      if (alert.type === "photo" && alert.photoAlert) {
        photoIds.push(alert.photoAlert.id);
      } else if (alert.type === "activity") {
        activityIds.push(alert.id);
      }
    });
    if (activityIds.length > 0) { deleteActivityLogs(activityIds); refreshAlerts(); }
    photoIds.forEach(id => deletePhotoAlert(id));
    if (photoIds.length > 0) setRefreshKey(k => k + 1);
    setSelectedIds(new Set());
  };

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: "all", label: t("alertPanel.all") },
    { key: "photo", label: t("alertPanel.photo") },
    { key: "activity", label: t("alertPanel.activity") },
  ];

  const goToPage = (p: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, p)));
    setSelectedIds(new Set());
  };

  const pageGroup = Math.floor((currentPage - 1) / 10);
  const pageGroupStart = pageGroup * 10 + 1;
  const pageGroupEnd = Math.min(pageGroupStart + 9, totalPages);
  const pageNumbers: number[] = [];
  for (let i = pageGroupStart; i <= pageGroupEnd; i++) pageNumbers.push(i);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (open) { setRefreshKey(k => k + 1); setSelectedIds(new Set()); setIsSelectMode(false); } }}>
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
        <SheetHeader className="p-4 pb-3 pr-12 border-b border-white/20">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold text-white">{t("alertPanel.title")}</SheetTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds(new Set()); }}
                className="text-xs font-medium px-2 py-1 rounded-lg transition-all"
                style={{ background: isSelectMode ? 'hsla(52, 100%, 60%, 0.9)' : 'hsla(0,0%,100%,0.15)', color: isSelectMode ? '#333' : 'white' }}
              >
                {isSelectMode ? t("alertPanel.cancel") : t("alertPanel.select")}
              </button>
              {totalUnread > 0 && !isSelectMode && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'hsla(52, 100%, 60%, 1)' }}
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {t("alertPanel.markAllRead")}
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

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

        {isSelectMode && unifiedAlerts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/15" style={{ background: 'hsla(0,0%,0%,0.15)' }}>
            <button
              onClick={allSelected ? deselectAll : selectAll}
              className="flex items-center gap-1.5 text-xs font-medium text-white/90"
            >
              {allSelected ? <CheckSquare className="w-4 h-4" /> : someSelected ? <MinusSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allSelected ? t("alertPanel.deselectAll") : t("alertPanel.selectAll")}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg"
                style={{ background: 'hsla(0, 70%, 55%, 0.8)', color: 'white' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("alertPanel.deleteCount", { count: selectedIds.size })}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2 alert-history-scroll">
          {unifiedAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/50">
              <Bell className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-semibold text-white/70">{t("alertPanel.noAlerts")}</p>
            </div>
          ) : (
            pageAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center gap-2">
                {isSelectMode && (
                  <button onClick={() => toggleSelect(alert.id)} className="flex-shrink-0 text-white/80">
                    {selectedIds.has(alert.id) ? <CheckSquare className="w-5 h-5" style={{ color: 'hsla(52, 100%, 60%, 1)' }} /> : <Square className="w-5 h-5" />}
                  </button>
                )}
                <div className="flex-1 min-w-0">
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
                      hideDelete={isSelectMode}
                    />
                  ) : alert.activityLog ? (
                    <AlertItem
                      alert={alert.activityLog}
                      onMarkRead={(id) => { markLogAsRead(id); refreshAlerts(); }}
                    />
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 px-4 py-3 border-t border-white/20" style={{ background: 'hsla(0,0%,0%,0.1)' }}>
            <button onClick={() => goToPage(1)} disabled={currentPage === 1}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button onClick={() => goToPage(pageGroupStart - 10)} disabled={pageGroupStart <= 1}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronLeft className="w-4 h-4" /><ChevronLeft className="w-4 h-4 -ml-3" />
            </button>
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>

            {pageNumbers.map(p => (
              <button key={p} onClick={() => goToPage(p)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  p === currentPage ? "text-slate-800 shadow-sm" : "text-white/80 hover:bg-white/15"
                }`}
                style={p === currentPage ? { background: 'hsla(52, 100%, 60%, 0.9)' } : undefined}
              >
                {p}
              </button>
            ))}

            <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => goToPage(pageGroupEnd + 1)} disabled={pageGroupEnd >= totalPages}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronRight className="w-4 h-4" /><ChevronRight className="w-4 h-4 -ml-3" />
            </button>
            <button onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg text-white/80 disabled:text-white/30 hover:bg-white/15 disabled:hover:bg-transparent transition-colors">
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

function PhotoAlertItem({ alert, onView, onDelete, hideDelete }: { alert: UnifiedAlert; onView: () => void; onDelete: () => void; hideDelete?: boolean }) {
  const { t } = useTranslation();
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
      <button
        onClick={onView}
        className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center border border-white/25"
        style={{ background: 'hsla(0,0%,100%,0.15)' }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt={t("alertPanel.capture")} className="w-full h-full object-cover" />
        ) : (
          <Image className="w-5 h-5 text-white/50" />
        )}
      </button>

      <button onClick={onView} className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`font-bold text-sm truncate ${alert.is_read ? "text-white/70" : "text-white"}`}>
            {alert.title}
          </h4>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-white/70 whitespace-nowrap font-medium">
              {new Date(alert.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {alert.device_name && <span className="text-xs text-white/80 font-medium">{alert.device_name}</span>}
          {alert.device_name && alert.message && <span className="text-xs text-white/50">·</span>}
          {alert.message && <span className="text-xs text-white/80 truncate font-medium">{alert.message}</span>}
        </div>
      </button>

      {!hideDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-white/50 hover:text-red-300 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default AlertPanel;
