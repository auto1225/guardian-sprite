import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, MoreVertical, Crown, Star, Sparkles, CalendarDays } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { UserSerial } from "@/lib/websiteAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import laptopOn from "@/assets/laptop-on.png";
import laptopOff from "@/assets/laptop-off.png";
import wifiOn from "@/assets/wifi-on.png";
import wifiOff from "@/assets/wifi-off.png";
import cameraOn from "@/assets/camera-on.png";
import cameraOff from "@/assets/camera-off.png";

type Device = Database["public"]["Tables"]["devices"]["Row"];

const ITEMS_PER_PAGE = 5;

const PLAN_CONFIG: Record<string, { icon: typeof Crown; colorClass: string; bgClass: string }> = {
  free: { icon: Sparkles, colorClass: "text-emerald-300", bgClass: "bg-emerald-500/20 border-emerald-400/30" },
  basic: { icon: Star, colorClass: "text-blue-300", bgClass: "bg-blue-500/20 border-blue-400/30" },
  premium: { icon: Crown, colorClass: "text-amber-300", bgClass: "bg-amber-500/20 border-amber-400/30" },
};

interface DeviceManagePageProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
  onViewAlertHistory?: (deviceId: string) => void;
}

const DeviceManagePage = ({ isOpen, onClose, onSelectDevice, onViewAlertHistory }: DeviceManagePageProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, deleteDevice } = useDevices();
  const { serials, serialsLoading, effectiveUserId } = useAuth();
  const { toggleMonitoring } = useCommands();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [licenseMap, setLicenseMap] = useState<Map<string, string>>(new Map()); // serial_key → device_id

  const managedDevices = devices.filter(d => d.device_type !== "smartphone");

  // ★ licenses 테이블에서 serial_key → device_id 매핑 조회 (유일한 진실의 원천)
  useEffect(() => {
    if (!effectiveUserId || serials.length === 0) return;

    const fetchLicenses = async () => {
      try {
        const serialKeys = serials.map(s => s.serial_key).filter(Boolean);
        if (serialKeys.length === 0) return;

        const { data: licData, error: licError } = await supabase
          .from("licenses")
          .select("serial_key, device_id")
          .in("serial_key", serialKeys);

        if (licError) {
          console.error("[DeviceManage] License fetch error:", licError);
          return;
        }

        const map = new Map<string, string>();
        for (const lic of (licData || [])) {
          if (lic.serial_key && lic.device_id) {
            map.set(lic.serial_key, lic.device_id);
          }
        }
        console.log("[DeviceManage] License map:", Object.fromEntries(map));
        setLicenseMap(map);
      } catch (err) {
        console.error("[DeviceManage] License fetch failed:", err);
      }
    };

    fetchLicenses();
  }, [effectiveUserId, serials]);

  // ★ serial ↔ device 매칭: 3단계 매칭 시스템
  // 1순위: licenses 테이블 (serial_key → device_id)
  // 2순위: device metadata.serial_key
  // 3순위: 유일한 미매칭 온라인 기기 폴백
  const items = useMemo(() => {
    const usedDeviceIds = new Set<string>();
    const result: { serial: UserSerial | null; device: Device | null }[] = [];

    console.log("[DeviceManage] Matching serials:", serials.length, "devices:", managedDevices.length, "licenseMap:", licenseMap.size);

    for (const serial of serials) {
      const linkedDeviceId = licenseMap.get(serial.serial_key);
      if (linkedDeviceId) {
        const device = managedDevices.find(d => d.id === linkedDeviceId && !usedDeviceIds.has(d.id));
        if (device) {
          usedDeviceIds.add(device.id);
          result.push({ serial, device });
          console.log("[DeviceManage] ✅ License match:", serial.serial_key, "→", device.name);
          continue;
        }
      }

      // 2순위: device metadata에 저장된 serial_key로 매칭
      if (serial.serial_key) {
        const device = managedDevices.find(d =>
          !usedDeviceIds.has(d.id) &&
          (d.metadata as Record<string, unknown>)?.serial_key === serial.serial_key
        );
        if (device) {
          usedDeviceIds.add(device.id);
          result.push({ serial, device });
          console.log("[DeviceManage] ✅ Metadata match:", serial.serial_key, "→", device.name);
          continue;
        }
      }

      result.push({ serial, device: null });
      console.log("[DeviceManage] ⏳ No match:", serial.serial_key);
    }

    // 3순위: 온라인 기기 폴백 — 미매칭 시리얼 → 유일한 미매칭 온라인 기기
    const unmatchedOnlineDevices = managedDevices.filter(d =>
      !usedDeviceIds.has(d.id) && d.status !== "offline"
    );
    if (unmatchedOnlineDevices.length === 1) {
      const onlineDevice = unmatchedOnlineDevices[0];
      const unmatchedSerialIdx = result.findIndex(r =>
        r.device === null && r.serial
      );
      if (unmatchedSerialIdx !== -1) {
        usedDeviceIds.add(onlineDevice.id);
        result[unmatchedSerialIdx].device = onlineDevice;
        console.log("[DeviceManage] ✅ Online fallback:", result[unmatchedSerialIdx].serial?.serial_key, "→", onlineDevice.name);
      }
    }

    // 남은 미매칭 기기 추가 (시리얼 없이 존재하는 기기)
    for (const device of managedDevices) {
      if (!usedDeviceIds.has(device.id)) {
        result.push({ serial: null, device });
      }
    }

    return result;
  }, [serials, managedDevices, licenseMap]);

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const pageItems = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  const handleSetAsMain = async (deviceId: string) => {
    try {
      for (const d of managedDevices) {
        if ((d.metadata as Record<string, unknown>)?.is_main) {
          await safeMetadataUpdate(d.id, { is_main: false });
        }
      }
      await safeMetadataUpdate(deviceId, { is_main: true });
      setSelectedDeviceId(deviceId);
      onSelectDevice(deviceId);
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: t("deviceManage.mainDevice"), description: t("deviceManage.mainDeviceDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("deviceManage.mainDeviceFailed"), variant: "destructive" });
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      await deleteDevice.mutateAsync(deviceId);
      toast({ title: t("deviceManage.deviceDeleted"), description: t("deviceManage.deviceDeletedDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("deviceManage.deviceDeleteFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center p-4 border-b border-white/20">
        <button onClick={onClose} className="text-primary-foreground mr-3">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-primary-foreground font-bold text-lg">{t("deviceManage.title")}</h1>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 alert-history-scroll">
        {serialsLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
          </div>
        ) : pageItems.length === 0 ? (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>{t("deviceManage.noDevices")}</p>
            <p className="text-sm mt-2">{t("deviceManage.noDevicesHint")}</p>
          </div>
        ) : (
          pageItems.map((item, idx) => {
            const { serial, device } = item;
            const isMain = !!(device && (device.metadata as Record<string, unknown>)?.is_main);
            const isOnline = device ? device.status !== "offline" : false;
            const planConfig = PLAN_CONFIG[serial?.plan_type || "free"] || PLAN_CONFIG.free;
            const PlanIcon = planConfig.icon;

            return (
              <div
                key={serial?.id || device?.id || idx}
                className="rounded-2xl p-4 bg-[hsla(220,35%,18%,0.95)] backdrop-blur-xl border border-white/30 shadow-xl"
              >
                {/* Top row: device name + actions */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isMain && (
                      <span className="bg-status-active text-accent-foreground px-2 py-0.5 rounded text-[10px] font-bold shrink-0">
                        MAIN
                      </span>
                    )}
                    {device ? (
                      <>
                        <span className="text-white font-bold truncate drop-shadow-sm">{device.name}</span>
                        {device.battery_level !== null && (
                          <span className="text-white/90 text-sm font-semibold shrink-0">
                            {device.battery_level}% <span className="text-status-active">⚡</span>
                          </span>
                        )}
                      </>
                    ) : serial?.device_name ? (
                      <span className="text-white/80 font-semibold truncate drop-shadow-sm">{serial.device_name}</span>
                    ) : (
                      <span className="text-white/70 text-sm font-medium">{t("deviceManage.noDeviceConnected")}</span>
                    )}
                  </div>

                  {device && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-primary-foreground p-1 shrink-0">
                          <MoreVertical className="w-5 h-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-primary/90 backdrop-blur-xl border border-white/25 z-[100]">
                        {!isMain && (
                          <DropdownMenuItem onClick={() => handleSetAsMain(device.id)} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
                            {t("deviceManage.setAsMain")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onViewAlertHistory?.(device.id)} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
                          {t("deviceManage.alertHistory")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDeleteDevice(device.id)} className="text-destructive focus:bg-white/15 focus:text-destructive">
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Serial info */}
                {serial && serial.serial_key && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-sm font-bold tracking-wider text-yellow-300 drop-shadow-sm">
                      {serial.serial_key}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${planConfig.bgClass}`}>
                      <PlanIcon className={`w-3 h-3 ${planConfig.colorClass}`} />
                      <span className={planConfig.colorClass}>{t(`plan.${serial.plan_type}`)}</span>
                    </span>
                  </div>
                )}

                {/* Remaining days */}
                {serial && serial.remaining_days !== null && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <CalendarDays className="w-3.5 h-3.5 text-white/60" />
                    <span className={`text-xs font-semibold ${
                      serial.remaining_days <= 3 ? "text-red-300" :
                      serial.remaining_days <= 7 ? "text-amber-300" : "text-white/80"
                    }`}>
                      {serial.remaining_days}{t("plan.days")} {t("plan.remainingDays")}
                    </span>
                  </div>
                )}

                {/* Device status icons + monitoring toggle */}
                {device && (
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-6">
                      <StatusIcon iconOn={laptopOn} iconOff={laptopOff} active={isOnline} label={device.device_type === "desktop" ? "Desktop" : device.device_type === "tablet" ? "Tablet" : "Laptop"} />
                      <StatusIcon iconOn={wifiOn} iconOff={wifiOff} active={isOnline && device.is_network_connected} label="Network" />
                      <StatusIcon iconOn={cameraOn} iconOff={cameraOff} active={isOnline && device.is_camera_connected} label="Camera" />
                    </div>
                    <button
                      onClick={() => toggleMonitoring(device.id, !device.is_monitoring)}
                      className={`px-6 py-2 rounded-lg text-base font-bold transition-all ${
                        device.is_monitoring
                          ? "bg-status-active text-accent-foreground shadow-[0_0_12px_hsla(48,100%,55%,0.4)]"
                          : "bg-white/20 text-primary-foreground/70"
                      }`}
                    >
                      {device.is_monitoring ? t("common.on") : t("common.off")}
                    </button>
                  </div>
                )}

                {/* No device placeholder */}
                {!device && (
                  <div className="mt-2 py-2 text-center">
                    <span className="text-white/60 text-xs font-medium">⏳ {t("deviceManage.noDeviceConnected")}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 p-4 border-t border-white/20">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                page === i + 1
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-white/10 text-white/60 hover:bg-white/15"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StatusIcon = ({ iconOn, iconOff, active, label }: { iconOn: string; iconOff: string; active: boolean; label: string }) => (
  <div className="flex flex-col items-center gap-1">
    <img src={active ? iconOn : iconOff} alt={label} className="w-10 h-10 object-contain" />
    <span className="text-primary-foreground text-[10px] font-medium">{label}</span>
  </div>
);

export default DeviceManagePage;
