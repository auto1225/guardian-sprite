import { useState } from "react";
import { ArrowLeft, MoreVertical, Plus } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
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
import meercopOn from "@/assets/meercop-on.png";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceType = Database["public"]["Enums"]["device_type"];

interface DeviceManagePageProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
}

const DeviceManagePage = ({ isOpen, onClose, onSelectDevice }: DeviceManagePageProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, addDevice, deleteDevice } = useDevices();
  const { toggleMonitoring } = useCommands();
  const { toast } = useToast();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceType, setNewDeviceType] = useState<DeviceType>("laptop");

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

    try {
      await addDevice.mutateAsync({
        name: newDeviceName,
        device_type: newDeviceType,
      });
      toast({
        title: "기기 등록",
        description: "새 기기가 등록되었습니다.",
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
    <div className="fixed inset-0 bg-primary z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-primary-foreground/20">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-primary-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-primary-foreground font-bold text-lg">노트북 관리</h1>
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
        {devices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            isMain={device.id === selectedDeviceId}
            onSetAsMain={() => handleSetAsMain(device.id)}
            onToggleMonitoring={() => handleToggleMonitoring(device)}
            onDelete={() => handleDeleteDevice(device.id)}
          />
        ))}

        {devices.length === 0 && (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>등록된 노트북이 없습니다</p>
            <p className="text-sm mt-2">+ 버튼을 눌러 기기를 등록하세요</p>
          </div>
        )}
      </div>

      {/* Add Device Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>새 기기 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">기기 이름</label>
              <Input
                placeholder="예: 회사 노트북"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">기기 유형</label>
              <Select value={newDeviceType} onValueChange={(v) => setNewDeviceType(v as DeviceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="laptop">노트북</SelectItem>
                  <SelectItem value="desktop">데스크탑</SelectItem>
                  <SelectItem value="smartphone">스마트폰</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleAddDevice}>
              등록
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
  onSetAsMain: () => void;
  onToggleMonitoring: () => void;
  onDelete: () => void;
}

const DeviceCard = ({ device, isMain, onSetAsMain, onToggleMonitoring, onDelete }: DeviceCardProps) => {
  const isOnline = device.status !== "offline";
  const isMonitoring = device.is_monitoring;

  return (
    <div className={`rounded-xl p-4 ${
      isMain ? "bg-sky-dark/50 border-2 border-accent" : "bg-sky-dark/30"
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isMain && (
            <span className="bg-status-active text-white px-2 py-0.5 rounded text-xs font-bold">
              MAIN
            </span>
          )}
          <span className="text-primary-foreground font-semibold">{device.name}</span>
          {device.battery_level !== null && (
            <span className="text-primary-foreground/70 text-sm">
              {device.battery_level}% 🔋
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-primary-foreground p-1">
              <MoreVertical className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isMain && (
              <DropdownMenuItem onClick={onSetAsMain}>
                메인으로 설정
              </DropdownMenuItem>
            )}
            <DropdownMenuItem>
              이벤트 조회
            </DropdownMenuItem>
            <DropdownMenuItem>
              설정
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={onDelete}
            >
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status icons and toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusIcon 
            iconOn={laptopOn} 
            iconOff={laptopOff} 
            active={isOnline} 
            label="Laptop" 
          />
          <StatusIcon 
            icon={meercopOn}
            active={isMonitoring} 
            label="MeerCOP" 
          />
          <StatusIcon 
            iconOn={wifiOn} 
            iconOff={wifiOff} 
            active={isOnline} 
            label="Network" 
          />
          <StatusIcon 
            iconOn={cameraOn} 
            iconOff={cameraOff} 
            active={true} 
            label="Camera" 
          />
        </div>

        <button
          onClick={onToggleMonitoring}
          className={`px-5 py-2 rounded-lg text-sm font-bold ${
            isMonitoring
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isMonitoring ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
};

interface StatusIconProps {
  iconOn?: string;
  iconOff?: string;
  icon?: string;
  active: boolean;
  label: string;
}

const StatusIcon = ({ iconOn, iconOff, icon, active, label }: StatusIconProps) => {
  const imgSrc = icon || (active ? iconOn : iconOff);
  
  return (
    <div className="flex flex-col items-center gap-0.5">
      <img 
        src={imgSrc} 
        alt={label} 
        className="w-10 h-10 object-contain"
      />
      <span className="text-primary-foreground text-[10px]">{label}</span>
    </div>
  );
};

export default DeviceManagePage;
