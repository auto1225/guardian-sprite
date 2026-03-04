import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissionCheck, PermissionItem } from "@/hooks/usePermissionCheck";
import { Bell, Camera, MapPin, ShieldAlert, ShieldCheck, X, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ReactNode> = {
  notification: <Bell className="w-5 h-5" />,
  camera: <Camera className="w-5 h-5" />,
  geolocation: <MapPin className="w-5 h-5" />,
};

const PermissionRow = ({
  item,
  onRequest,
}: {
  item: PermissionItem;
  onRequest: (item: PermissionItem) => void;
}) => {
  const { t } = useTranslation();
  const isGranted = item.status === "granted";
  const isDenied = item.status === "denied";
  const isPrompt = item.status === "prompt";

  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-xl transition-all",
      isGranted
        ? "bg-emerald-500/10 border border-emerald-500/20"
        : isDenied
          ? "bg-red-500/10 border border-red-500/20"
          : "bg-white/5 border border-white/10"
    )}>
      <div className={cn(
        "mt-0.5 p-1.5 rounded-lg",
        isGranted ? "text-emerald-400 bg-emerald-500/20" : isDenied ? "text-red-400 bg-red-500/20" : "text-yellow-400 bg-yellow-500/20"
      )}>
        {iconMap[item.key] || <ShieldAlert className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{t(item.name)}</span>
          {isGranted && <ShieldCheck className="w-4 h-4 text-emerald-400" />}
          {isDenied && <AlertTriangle className="w-4 h-4 text-red-400" />}
        </div>
        <p className="text-xs text-white/60 mt-0.5">{t(item.description)}</p>
        {isDenied && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {t("permissions.deniedWarning", { features: t(item.affectedFeatures) })}
          </p>
        )}
        {/* 허용 버튼: prompt 상태 */}
        {isPrompt && (
          <button
            onClick={() => onRequest(item)}
            className="mt-2 px-3 py-1.5 text-xs font-semibold bg-accent/80 text-accent-foreground rounded-lg hover:bg-accent active:scale-95 transition-all"
          >
            {t("permissions.allow")}
          </button>
        )}
        {/* 재시도 버튼: denied 상태 */}
        {isDenied && (
          <div className="mt-1.5">
            <button
              onClick={() => onRequest(item)}
              className="px-3 py-1.5 text-xs font-semibold bg-white/10 text-white/80 rounded-lg hover:bg-white/15 active:scale-95 transition-all flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              {t("permissions.retry")}
            </button>
            <p className="text-[10px] text-white/40 mt-1">{t("permissions.deniedHelp")}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default function PermissionRequestPopup() {
  const { t } = useTranslation();
  const { permissions, shouldShow, dismiss, refresh } = usePermissionCheck();
  const [closing, setClosing] = useState(false);

  if (!shouldShow) return null;

  const nonGranted = permissions.filter(p => p.status !== "granted");
  const hasPrompt = nonGranted.some(p => p.status === "prompt");

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      dismiss();
      setClosing(false);
    }, 200);
  };

  const handleRequest = async (item: PermissionItem) => {
    await item.request();
    refresh();
  };

  const handleAllowAll = async () => {
    for (const item of nonGranted) {
      await item.request();
    }
    refresh();
  };

  return (
    <div className={cn(
      "fixed inset-0 z-[100] flex items-center justify-center p-4",
      closing ? "animate-out fade-out-0 duration-200" : "animate-in fade-in-0 duration-300"
    )}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      
      {/* Popup */}
      <div className={cn(
        "relative w-full max-w-sm rounded-2xl overflow-hidden",
        "bg-[hsla(220,35%,18%,0.85)] backdrop-blur-xl",
        "border border-white/15",
        "shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]",
        closing ? "animate-out zoom-out-95 duration-200" : "animate-in zoom-in-95 duration-300"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-accent" />
            <h2 className="text-base font-bold text-white">{t("permissions.title")}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
        
        <p className="px-5 text-xs text-white/50 mb-3">{t("permissions.subtitle")}</p>

        {/* Permission List */}
        <div className="px-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {permissions.map((item) => (
            <PermissionRow key={item.key} item={item} onRequest={handleRequest} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 mt-2 flex gap-2">
          {nonGranted.length > 0 && (
            <button
              onClick={handleAllowAll}
              className={cn(
                "flex-1 py-2.5 font-bold text-sm rounded-xl active:scale-95 transition-transform",
                hasPrompt
                  ? "bg-accent text-accent-foreground"
                  : "bg-white/15 text-white/80"
              )}
            >
              {t("permissions.allowAll")}
            </button>
          )}
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 bg-white/10 text-white/70 font-medium text-sm rounded-xl hover:bg-white/15 active:scale-95 transition-all"
          >
            {t("permissions.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
