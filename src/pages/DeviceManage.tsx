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
    <div className="rounded-2xl p-3 bg-[#5BBFCF]">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isMain && (
            <span className="bg-[#4CAF50] text-white px-2.5 py-1 rounded text-xs font-bold">
              MAIN
            </span>
          )}
          <span className="text-white font-semibold">{device.name}</span>
          {device.battery_level !== null && (
            <span className="text-white text-sm flex items-center gap-1">
              {device.battery_level}%
              <span className="text-[#4CAF50]">⚡</span>
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-white p-1">
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
        <div className="flex items-center gap-4">
          <StatusIconWithCheck 
            bgColor="bg-[#2196F3]"
            isActive={isOnline}
            label="Laptop"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
            </svg>
          </StatusIconWithCheck>
          
          <StatusIconWithCheck 
            bgColor="bg-[#FDD835]"
            isActive={isMonitoring}
            label="MeerCOP"
          >
            <span className="text-white text-sm font-bold">M</span>
          </StatusIconWithCheck>
          
          <StatusIconWithCheck 
            bgColor="bg-[#2196F3]"
            isActive={isOnline}
            label="Network"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3C7.5 3 3.5 5 1 8l1.5 1.5C4.5 7.5 8 6 12 6s7.5 1.5 9.5 3.5L23 8c-2.5-3-6.5-5-11-5zm0 6c-3 0-5.5 1.5-7 3.5L6.5 14c1-1.5 3-2.5 5.5-2.5s4.5 1 5.5 2.5l1.5-1.5c-1.5-2-4-3.5-7-3.5zm0 6c-1.5 0-3 .5-4 1.5L12 21l4-4.5c-1-.5-2.5-1.5-4-1.5z" />
            </svg>
          </StatusIconWithCheck>
          
          <StatusIconWithCheck 
            bgColor="bg-[#2196F3]"
            isActive={true}
            label="Camera"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="3"/>
              <path d="M20 4h-3.2l-1.8-2H9l-1.8 2H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm-8 13a5 5 0 110-10 5 5 0 010 10z"/>
            </svg>
          </StatusIconWithCheck>
        </div>

        <button
          onClick={onToggleMonitoring}
          className={`px-6 py-2 rounded-lg text-base font-bold ${
            isMonitoring
              ? "bg-[#C8E600] text-[#333333]"
              : "bg-gray-400 text-white"
          }`}
        >
          {isMonitoring ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
};

interface StatusIconWithCheckProps {
  bgColor: string;
  isActive: boolean;
  label: string;
  children: React.ReactNode;
}

const StatusIconWithCheck = ({ bgColor, isActive, label, children }: StatusIconWithCheckProps) => {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center`}>
          {children}
        </div>
        {isActive && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#4CAF50] rounded-full flex items-center justify-center border-2 border-[#5BBFCF]">
            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </div>
        )}
      </div>
      <span className="text-white text-[10px] font-medium">{label}</span>
    </div>
  );
};

export default DeviceManagePage;
