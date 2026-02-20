import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreVertical, Plus, Copy, ArrowUp, ArrowDown } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { useAuth } from "@/hooks/useAuth";
import { sortDevicesByOrder, reorderDevices } from "@/lib/deviceSortOrder";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import laptopOn from "@/assets/laptop-on.png";
import laptopOff from "@/assets/laptop-off.png";
import wifiOn from "@/assets/wifi-on.png";
import wifiOff from "@/assets/wifi-off.png";
import cameraOn from "@/assets/camera-on.png";
import cameraOff from "@/assets/camera-off.png";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceType = Database["public"]["Enums"]["device_type"];

interface DeviceManagePageProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
  onViewAlertHistory?: (deviceId: string) => void;
}

const DeviceManagePage = ({ isOpen, onClose, onSelectDevice, onViewAlertHistory }: DeviceManagePageProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, addDevice, deleteDevice } = useDevices();
  const { user } = useAuth();
  const { toggleMonitoring } = useCommands();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceType, setNewDeviceType] = useState<DeviceType>("laptop");
  const [serialMap, setSerialMap] = useState<Record<string, string>>({});

  const managedDevices = devices.filter(d => d.device_type !== "smartphone");

  useEffect(() => {
    if (!isOpen || !user) return;
    const fetchSerials = async () => {
      const { data } = await supabase
        .from("licenses")
        .select("device_id, serial_key")
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (data) {
        const map: Record<string, string> = {};
        data.forEach(l => { if (l.device_id) map[l.device_id] = l.serial_key; });
        setSerialMap(map);
      }
    };
    fetchSerials();
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSetAsMain = async (deviceId: string) => {
    try {
      for (const d of managedDevices) {
        const m = (d.metadata as Record<string, unknown>) || {};
        if (m.is_main) {
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

  const handleToggleMonitoring = async (device: Device) => {
    await toggleMonitoring(device.id, !device.is_monitoring);
  };

  const handleAddDevice = async () => {
    if (!newDeviceName.trim()) {
      toast({ title: t("common.error"), description: t("deviceManage.deviceNameRequired"), variant: "destructive" });
      return;
    }
    if (isAdding) return;
    setIsAdding(true);
    try {
      const { data: serialData, error: serialError } = await supabase.functions.invoke("create-serial", { body: {} });
      if (serialError || !serialData?.success) throw new Error("Serial creation failed");
      const newSerialKey = serialData.license.serial_key;
      const { data: validateData, error: validateError } = await supabase.functions.invoke("validate-serial", {
        body: { serial_key: newSerialKey, device_name: newDeviceName, device_type: newDeviceType },
      });
      if (validateError || !validateData?.success) throw new Error("Device registration failed");
      setSerialMap(prev => ({ ...prev, [validateData.device_id]: newSerialKey }));
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: t("deviceManage.registrationComplete"), description: `${t("deviceManage.serialLabel")}: ${newSerialKey}` });
      setNewDeviceName("");
      setNewDeviceType("laptop");
      setIsAddDialogOpen(false);
    } catch {
      toast({ title: t("common.error"), description: t("deviceManage.registrationFailed"), variant: "destructive" });
    } finally {
      setIsAdding(false);
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
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-primary-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-primary-foreground font-bold text-lg">{t("deviceManage.title")}</h1>
        </div>
        <button onClick={() => setIsAddDialogOpen(true)} className="text-primary-foreground p-1">
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sortDevicesByOrder(managedDevices).map((device, idx, arr) => (
          <DeviceCardItem
            key={device.id}
            device={device}
            isMain={!!((device.metadata as Record<string, unknown>)?.is_main)}
            serialKey={serialMap[device.id]}
            onSetAsMain={() => handleSetAsMain(device.id)}
            onToggleMonitoring={() => handleToggleMonitoring(device)}
            onDelete={() => handleDeleteDevice(device.id)}
            onViewAlertHistory={() => onViewAlertHistory?.(device.id)}
            canMoveUp={idx > 0}
            canMoveDown={idx < arr.length - 1}
            onMoveUp={async () => { await reorderDevices(arr, device.id, "up"); queryClient.invalidateQueries({ queryKey: ["devices"] }); }}
            onMoveDown={async () => { await reorderDevices(arr, device.id, "down"); queryClient.invalidateQueries({ queryKey: ["devices"] }); }}
          />
        ))}

        {managedDevices.length === 0 && (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>{t("deviceManage.noDevices")}</p>
            <p className="text-sm mt-2">{t("deviceManage.noDevicesHint")}</p>
          </div>
        )}
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="bg-primary/80 backdrop-blur-xl border border-white/25 shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground">{t("deviceManage.addDevice")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-foreground">{t("deviceManage.deviceName")}</label>
              <Input
                placeholder={t("deviceManage.deviceNamePlaceholder")}
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                className="bg-white/15 border-white/25 text-primary-foreground placeholder:text-primary-foreground/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-foreground">{t("deviceManage.deviceTypeLabel")}</label>
              <Select value={newDeviceType} onValueChange={(v) => setNewDeviceType(v as DeviceType)}>
                <SelectTrigger className="bg-white/15 border-white/25 text-primary-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-primary/90 backdrop-blur-xl border border-white/25">
                  <SelectItem value="laptop" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">{t("settings.laptop")}</SelectItem>
                  <SelectItem value="desktop" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">{t("settings.desktop")}</SelectItem>
                  <SelectItem value="tablet" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">{t("settings.tablet")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddDevice} disabled={isAdding} className="w-full bg-white/20 backdrop-blur-sm border border-white/25 text-primary-foreground hover:bg-white/30 disabled:opacity-50">
              {isAdding ? t("common.adding") : t("common.register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface DeviceCardItemProps {
  device: Device;
  isMain: boolean;
  serialKey?: string;
  onSetAsMain: () => void;
  onToggleMonitoring: () => void;
  onDelete: () => void;
  onViewAlertHistory: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const DeviceCardItem = ({ device, isMain, serialKey, onSetAsMain, onToggleMonitoring, onDelete, onViewAlertHistory, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: DeviceCardItemProps) => {
  const { t } = useTranslation();
  const isOnline = device.status !== "offline";
  const isMonitoring = device.is_monitoring;

  return (
    <div className="rounded-2xl p-4 bg-white/15 backdrop-blur-xl border border-white/25 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex flex-col gap-0.5 shrink-0">
            <button onClick={onMoveUp} disabled={!canMoveUp} className="p-0.5 rounded text-white/50 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={onMoveDown} disabled={!canMoveDown} className="p-0.5 rounded text-white/50 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed">
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>
          {isMain && (
            <span className="bg-status-active text-accent-foreground px-2.5 py-1 rounded text-xs font-bold shrink-0">
              MAIN
            </span>
          )}
          <span className="text-primary-foreground font-semibold truncate">{device.name}</span>
          {device.battery_level !== null && (
            <span className="text-primary-foreground/80 text-sm flex items-center gap-1 shrink-0">
              {device.battery_level}%
              <span className="text-status-active">⚡</span>
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-primary-foreground p-1 shrink-0">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-primary/90 backdrop-blur-xl border border-white/25 shadow-xl z-[100]">
            {!isMain && (
              <DropdownMenuItem onClick={onSetAsMain} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
                {t("deviceManage.setAsMain")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onViewAlertHistory} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
              {t("deviceManage.alertHistory")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:bg-white/15 focus:text-destructive" onClick={onDelete}>
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {serialKey && (
        <div className="flex items-center gap-1.5 mb-3 mt-1">
          <span className="text-primary-foreground/60 text-xs">{t("deviceManage.serialPrefix")}</span>
          <span className="font-mono text-xs font-bold tracking-wider" style={{ color: 'hsla(52, 100%, 60%, 1)' }}>{serialKey}</span>
        </div>
      )}
      {!serialKey && (
        <div className="flex items-center gap-1.5 mb-3 mt-1">
          <span className="text-primary-foreground/40 text-xs">{t("deviceManage.serialNotLinked")}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <StatusIconItem iconOn={laptopOn} iconOff={laptopOff} isActive={isOnline} label={device.device_type === "desktop" ? "Desktop" : device.device_type === "tablet" ? "Tablet" : "Laptop"} />
          <StatusIconItem iconOn={wifiOn} iconOff={wifiOff} isActive={isOnline} label="Network" />
          <StatusIconItem iconOn={cameraOn} iconOff={cameraOff} isActive={true} label="Camera" />
        </div>

        <button
          onClick={onToggleMonitoring}
          className={`px-6 py-2 rounded-lg text-base font-bold transition-all ${
            isMonitoring
              ? "bg-status-active text-accent-foreground shadow-[0_0_12px_hsla(48,100%,55%,0.4)]"
              : "bg-white/20 text-primary-foreground/70 backdrop-blur-sm"
          }`}
        >
          {isMonitoring ? t("common.on") : t("common.off")}
        </button>
      </div>
    </div>
  );
};

interface StatusIconItemProps {
  iconOn: string;
  iconOff: string;
  isActive: boolean;
  label: string;
}

const StatusIconItem = ({ iconOn, iconOff, isActive, label }: StatusIconItemProps) => {
  return (
    <div className="flex flex-col items-center gap-1">
      <img src={isActive ? iconOn : iconOff} alt={label} className="w-10 h-10 object-contain" />
      <span className="text-primary-foreground text-[10px] font-medium">{label}</span>
    </div>
  );
};

export default DeviceManagePage;
