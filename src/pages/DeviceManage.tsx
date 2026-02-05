import { ArrowLeft, Settings, MoreVertical } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface DeviceManagePageProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
}

const DeviceManagePage = ({ isOpen, onClose, onSelectDevice }: DeviceManagePageProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, deleteDevice } = useDevices();
  const { toggleMonitoring } = useCommands();

  if (!isOpen) return null;

  const handleSetAsMain = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    onSelectDevice(deviceId);
  };

  const handleToggleMonitoring = async (device: Device) => {
    await toggleMonitoring(device.id, !device.is_monitoring);
  };

  return (
    <div className="fixed inset-0 bg-primary z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-primary-foreground/20">
        <button onClick={onClose} className="text-primary-foreground">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-primary-foreground font-bold text-lg">노트북 관리</h1>
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {devices.map((device, index) => (
          <div
            key={device.id}
            className={`rounded-xl p-4 ${
              device.id === selectedDeviceId
                ? "bg-primary-foreground/20 border-2 border-primary-foreground"
                : "bg-sky-dark/30"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {index === 0 && (
                  <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded text-xs font-bold">
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
                  <DropdownMenuItem onClick={() => handleSetAsMain(device.id)}>
                    주 관리 노트북으로 설정
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    이벤트 조회
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings className="w-4 h-4 mr-2" />
                    설정
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => deleteDevice.mutate(device.id)}
                  >
                    삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Status icons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon
                  active={device.status !== "offline"}
                  label="Laptop"
                />
                <StatusIcon
                  active={device.is_monitoring}
                  label="MeerCOP"
                  icon="M"
                />
                <StatusIcon
                  active={device.status !== "offline"}
                  label="Network"
                  icon="📶"
                />
                <StatusIcon
                  active={true}
                  label="Camera"
                  icon="📷"
                />
              </div>

              <button
                onClick={() => handleToggleMonitoring(device)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${
                  device.is_monitoring
                    ? "bg-status-active text-white"
                    : "bg-muted-foreground text-white"
                }`}
              >
                {device.is_monitoring ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        ))}

        {devices.length === 0 && (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>등록된 노트북이 없습니다</p>
            <p className="text-sm mt-2">노트북 앱에서 로그인하여 등록하세요</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface StatusIconProps {
  active: boolean;
  label: string;
  icon?: string;
}

const StatusIcon = ({ active, icon }: StatusIconProps) => {
  const baseClass = "w-8 h-8 rounded-full flex items-center justify-center text-xs";
  const colorClass = active ? "bg-status-active" : "bg-destructive";

  return (
    <div className={`${baseClass} ${colorClass}`}>
      <span className="text-white">{icon || "💻"}</span>
    </div>
  );
};

export default DeviceManagePage;
