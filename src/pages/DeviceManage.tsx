import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreVertical, Plus, Copy } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceType, setNewDeviceType] = useState<DeviceType>("laptop");
  const [serialMap, setSerialMap] = useState<Record<string, string>>({});

  // 스마트폰 제외한 기기 목록
  const managedDevices = devices.filter(d => d.device_type !== "smartphone");

  // 시리얼 넘버 로드
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

  const handleSetAsMain = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    onSelectDevice(deviceId);
    toast({
      title: "메인 기기 설정",
      description: "선택한 기기가 메인으로 설정되었습니다.",
    });
  };

  const handleToggleMonitoring = async (device: Device) => {
    await toggleMonitoring(device.id, !device.is_monitoring);
  };

  const handleAddDevice = async () => {
    if (!newDeviceName.trim()) {
      toast({
        title: "오류",
        description: "기기 이름을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    if (isAdding) return;
    setIsAdding(true);

    try {
      // 1. 시리얼 넘버 생성
      const { data: serialData, error: serialError } = await supabase.functions.invoke("create-serial", {
        body: {},
      });

      if (serialError || !serialData?.success) {
        throw new Error("시리얼 생성 실패");
      }

      const newSerialKey = serialData.license.serial_key;

      // 2. validate-serial로 기기 등록 + 시리얼 연결을 한번에 처리
      const { data: validateData, error: validateError } = await supabase.functions.invoke("validate-serial", {
        body: { serial_key: newSerialKey, device_name: newDeviceName, device_type: newDeviceType },
      });

      if (validateError || !validateData?.success) {
        throw new Error("기기 등록 실패");
      }

      // 시리얼맵 갱신
      setSerialMap(prev => ({ ...prev, [validateData.device_id]: newSerialKey }));

      // 기기 목록 갱신
      queryClient.invalidateQueries({ queryKey: ["devices"] });

      toast({
        title: "기기 등록 완료",
        description: `시리얼: ${newSerialKey}`,
      });
      setNewDeviceName("");
      setNewDeviceType("laptop");
      setIsAddDialogOpen(false);
    } catch (error) {
      toast({
        title: "오류",
        description: "기기 등록에 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      await deleteDevice.mutateAsync(deviceId);
      toast({
        title: "기기 삭제",
        description: "기기가 삭제되었습니다.",
      });
    } catch (error) {
      toast({
        title: "오류",
        description: "기기 삭제에 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-primary-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-primary-foreground font-bold text-lg">기기 관리</h1>
        </div>
        <button 
          onClick={() => setIsAddDialogOpen(true)}
          className="text-primary-foreground p-1"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {managedDevices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            isMain={device.id === selectedDeviceId}
            serialKey={serialMap[device.id]}
            onSetAsMain={() => handleSetAsMain(device.id)}
            onToggleMonitoring={() => handleToggleMonitoring(device)}
            onDelete={() => handleDeleteDevice(device.id)}
            onViewAlertHistory={() => onViewAlertHistory?.(device.id)}
          />
        ))}

        {managedDevices.length === 0 && (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>등록된 기기가 없습니다</p>
            <p className="text-sm mt-2">+ 버튼을 눌러 기기를 등록하세요</p>
          </div>
        )}
      </div>

      {/* Add Device Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="bg-primary/80 backdrop-blur-xl border border-white/25 shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground">새 기기 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-foreground">기기 이름</label>
              <Input
                placeholder="예: 회사 노트북"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                className="bg-white/15 border-white/25 text-primary-foreground placeholder:text-primary-foreground/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-foreground">기기 유형</label>
              <Select value={newDeviceType} onValueChange={(v) => setNewDeviceType(v as DeviceType)}>
                <SelectTrigger className="bg-white/15 border-white/25 text-primary-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-primary/90 backdrop-blur-xl border border-white/25">
                  <SelectItem value="laptop" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">노트북</SelectItem>
                  <SelectItem value="desktop" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">컴퓨터</SelectItem>
                  <SelectItem value="tablet" className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">태블릿</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddDevice} disabled={isAdding} className="w-full bg-white/20 backdrop-blur-sm border border-white/25 text-primary-foreground hover:bg-white/30 disabled:opacity-50">
              {isAdding ? "등록 중..." : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface DeviceCardProps {
  device: Device;
  isMain: boolean;
  serialKey?: string;
  onSetAsMain: () => void;
  onToggleMonitoring: () => void;
  onDelete: () => void;
  onViewAlertHistory: () => void;
}

const DeviceCard = ({ device, isMain, serialKey, onSetAsMain, onToggleMonitoring, onDelete, onViewAlertHistory }: DeviceCardProps) => {
  const isOnline = device.status !== "offline";
  const isMonitoring = device.is_monitoring;

  return (
    <div className="rounded-2xl p-4 bg-white/15 backdrop-blur-xl border border-white/25 shadow-lg">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
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
                메인으로 설정
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onViewAlertHistory} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
              경보 이력
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:bg-white/15 focus:text-destructive"
              onClick={onDelete}
            >
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Serial number */}
      {serialKey && (
        <div className="flex items-center gap-1.5 mb-3 mt-1">
          <span className="text-primary-foreground/60 text-xs">시리얼:</span>
          <span className="font-mono text-xs font-bold tracking-wider" style={{ color: 'hsla(52, 100%, 60%, 1)' }}>{serialKey}</span>
        </div>
      )}
      {!serialKey && (
        <div className="flex items-center gap-1.5 mb-3 mt-1">
          <span className="text-primary-foreground/40 text-xs">시리얼 미연결</span>
        </div>
      )}

      {/* Status icons and toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <StatusIconItem 
            iconOn={laptopOn}
            iconOff={laptopOff}
            isActive={isOnline}
            label="Laptop"
          />
          <StatusIconItem 
            iconOn={wifiOn}
            iconOff={wifiOff}
            isActive={isOnline}
            label="Network"
          />
          <StatusIconItem 
            iconOn={cameraOn}
            iconOff={cameraOff}
            isActive={true}
            label="Camera"
          />
        </div>

        <button
          onClick={onToggleMonitoring}
          className={`px-6 py-2 rounded-lg text-base font-bold transition-all ${
            isMonitoring
              ? "bg-status-active text-accent-foreground shadow-[0_0_12px_hsla(48,100%,55%,0.4)]"
              : "bg-white/20 text-primary-foreground/70 backdrop-blur-sm"
          }`}
        >
          {isMonitoring ? "ON" : "OFF"}
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
      <img 
        src={isActive ? iconOn : iconOff} 
        alt={label} 
        className="w-10 h-10 object-contain"
      />
      <span className="text-primary-foreground text-[10px] font-medium">{label}</span>
    </div>
  );
};

export default DeviceManagePage;
