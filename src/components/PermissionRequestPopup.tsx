import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePermissionCheck, PermissionItem } from "@/hooks/usePermissionCheck";
import { Bell, Camera, MapPin, ShieldAlert, ShieldCheck, X, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ReactNode> = {
  notification: <Bell className="w-5 h-5" />,
  camera: <Camera className="w-5 h-5" />,
  geolocation: <MapPin className="w-5 h-5" />,
};

const PermissionRow = ({
  item,
  checked,
  onToggle,
}: {
  item: PermissionItem;
  checked: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();
  const isGranted = item.status === "granted";
  const isDenied = item.status === "denied";

  return (
    <button
      type="button"
      onClick={isGranted ? undefined : onToggle}
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl transition-all w-full text-left",
        isGranted
          ? "bg-emerald-500/10 border border-emerald-500/20"
          : isDenied
            ? checked
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-white/5 border border-white/10 opacity-50"
            : checked
              ? "bg-white/5 border border-white/10"
              : "bg-white/5 border border-white/10 opacity-50"
      )}
    >
      {/* 체크박스 */}
      <div className={cn(
        "mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
        isGranted
          ? "bg-emerald-500 border-emerald-500"
          : checked
            ? "bg-accent border-accent"
            : "border-white/30 bg-transparent"
      )}>
        {(isGranted || checked) && <Check className="w-3 h-3 text-white" />}
      </div>

      {/* 아이콘 */}
      <div className={cn(
        "mt-0.5 p-1.5 rounded-lg shrink-0",
        isGranted ? "text-emerald-400 bg-emerald-500/20" : isDenied ? "text-red-400 bg-red-500/20" : "text-yellow-400 bg-yellow-500/20"
      )}>
        {iconMap[item.key] || <ShieldAlert className="w-5 h-5" />}
      </div>

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{t(item.name)}</span>
          {isGranted && <ShieldCheck className="w-4 h-4 text-emerald-400" />}
          {isDenied && checked && <AlertTriangle className="w-4 h-4 text-red-400" />}
        </div>
        <p className="text-xs text-white/60 mt-0.5">{t(item.description)}</p>
        {isDenied && checked && (
          <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {t("permissions.deniedWarning", { features: t(item.affectedFeatures) })}
          </p>
        )}
        {!isGranted && !checked && (
          <p className="text-xs text-white/40 mt-1">
            {t("permissions.uncheckedWarning", { features: t(item.affectedFeatures) })}
          </p>
        )}
      </div>
    </button>
  );
};

export default function PermissionRequestPopup() {
  const { t } = useTranslation();
  const { permissions, shouldShow, dismiss, refresh } = usePermissionCheck();
  const [closing, setClosing] = useState(false);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});

  // 기본값: 모두 체크됨
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    permissions.forEach(p => {
      initial[p.key] = true; // 기본 체크
    });
    setCheckedMap(initial);
  }, [permissions]);

  if (!shouldShow) return null;

  const nonGranted = permissions.filter(p => p.status !== "granted");
  const checkedItems = nonGranted.filter(p => checkedMap[p.key]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      dismiss();
      setClosing(false);
    }, 200);
  };

  const toggleCheck = (key: string) => {
    setCheckedMap(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirm = async () => {
    // 체크된 항목만 권한 요청
    for (const item of checkedItems) {
      await item.request();
    }
    handleClose();
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
            <PermissionRow
              key={item.key}
              item={item}
              checked={checkedMap[item.key] ?? true}
              onToggle={() => toggleCheck(item.key)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 mt-2 flex gap-2">
          {checkedItems.length > 0 && (
            <button
              onClick={handleConfirm}
              className="flex-1 py-2.5 bg-accent text-accent-foreground font-bold text-sm rounded-xl active:scale-95 transition-transform"
            >
              {t("permissions.confirm")}
            </button>
          )}
          <button
            onClick={handleClose}
            className={cn(
              "py-2.5 bg-white/10 text-white/70 font-medium text-sm rounded-xl hover:bg-white/15 active:scale-95 transition-all",
              checkedItems.length > 0 ? "flex-1" : "flex-1"
            )}
          >
            {t("permissions.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
