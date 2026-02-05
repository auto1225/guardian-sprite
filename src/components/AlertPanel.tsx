import { Bell, X } from "lucide-react";
import { useAlerts } from "@/hooks/useAlerts";
import AlertItem from "./AlertItem";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface AlertPanelProps {
  deviceId: string | null;
}

const AlertPanel = ({ deviceId }: AlertPanelProps) => {
  const { alerts, unreadCount, markAsRead, markAllAsRead } = useAlerts(deviceId);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="relative p-2 text-primary-foreground">
          <Bell className="w-6 h-6" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">알림</SheetTitle>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead.mutate()}
                className="text-sm text-primary hover:underline"
              >
                모두 읽음
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="w-12 h-12 mb-3 opacity-50" />
              <p>알림이 없습니다</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onMarkRead={(id) => markAsRead.mutate(id)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AlertPanel;
