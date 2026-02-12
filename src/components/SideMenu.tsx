import { X, User, Laptop, Settings, LogOut, HelpCircle, Plus, Pencil, Camera } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useDevices } from "@/hooks/useDevices";
import logoImage from "@/assets/meercop-character.png";

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onPhotoHistoryClick?: () => void;
}

const SideMenu = ({ isOpen, onClose, onPhotoHistoryClick }: SideMenuProps) => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { devices, selectedDeviceId, setSelectedDeviceId } = useDevices();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "로그아웃",
      description: "안전하게 로그아웃되었습니다.",
    });
    onClose();
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleSelectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Menu Panel */}
      <div className="fixed left-0 top-0 h-full w-[70%] max-w-[280px] bg-primary z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/20">
          <div className="flex items-center gap-2">
            <img src={logoImage} alt="MeerCOP" className="w-10 h-10 object-contain" />
            <div>
              <p className="text-lg font-extrabold text-primary-foreground">MeerCOP</p>
              <p className="text-xs text-white/70">ver 1.0.6</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2">
            <X className="w-5 h-5 text-primary-foreground" />
          </button>
        </div>

        {/* Profile Section */}
        <div className="flex items-center gap-3 p-4 border-b border-white/20">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <User className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary-foreground">
              {user?.email?.split('@')[0] || '사용자'}
            </p>
            <p className="text-xs text-white/70">{user?.email || 'email@example.com'}</p>
            <p className="text-xs text-white/50">Normal Member</p>
          </div>
        </div>

        {/* Device Section */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="flex items-center gap-1 mb-2">
            <Laptop className="w-4 h-4 text-white/70" />
            <span className="text-xs font-bold text-white/70">내 디바이스</span>
          </div>

          {/* Add Device Button */}
          <button 
            onClick={() => handleNavigate('/install')}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-secondary/20 border border-dashed border-white/30 mb-2"
          >
            <Plus className="w-4 h-4 text-primary-foreground" />
            <span className="text-sm font-bold text-primary-foreground">디바이스 추가</span>
          </button>

          {/* Device Cards */}
          {devices?.map((device) => (
            <button
              key={device.id}
              onClick={() => handleSelectDevice(device.id)}
              className={`w-full flex items-center justify-between p-3 rounded-xl mb-2 transition-colors ${
                device.id === selectedDeviceId 
                  ? 'bg-secondary' 
                  : 'bg-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <Laptop className={`w-4 h-4 ${
                  device.id === selectedDeviceId 
                    ? 'text-secondary-foreground' 
                    : 'text-primary-foreground'
                }`} />
                <div className="text-left">
                  <p className={`text-sm font-bold ${
                    device.id === selectedDeviceId 
                      ? 'text-secondary-foreground' 
                      : 'text-primary-foreground'
                  }`}>
                    {device.name}
                  </p>
                  <p className={`text-xs ${
                    device.id === selectedDeviceId 
                      ? 'text-secondary-foreground/70' 
                      : 'text-white/70'
                  }`}>
                    {device.status === 'online' ? '온라인' : '오프라인'}
                    {device.battery_level && ` · ${device.battery_level}%`}
                  </p>
                </div>
              </div>
              <Pencil className={`w-4 h-4 ${
                device.id === selectedDeviceId 
                  ? 'text-secondary-foreground' 
                  : 'text-primary-foreground'
              }`} />
            </button>
          ))}
        </div>

        {/* Bottom Menu */}
        <div className="border-t border-white/20">
          <MenuItem icon={Camera} label="사진 알림 기록" onClick={() => { onPhotoHistoryClick?.(); onClose(); }} />
          <MenuItem icon={HelpCircle} label="Q&A / 도움말" />
          <MenuItem icon={Settings} label="설정" onClick={() => handleNavigate("/settings")} />
          <MenuItem 
            icon={LogOut} 
            label="로그아웃" 
            onClick={handleSignOut}
            destructive
          />
        </div>
      </div>
    </>
  );
};

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
}

const MenuItem = ({ icon: Icon, label, onClick, destructive }: MenuItemProps) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 w-full px-4 py-4 hover:bg-white/10 transition-colors"
  >
    <Icon className={`w-5 h-5 ${destructive ? 'text-destructive' : 'text-primary-foreground'}`} />
    <span className={`text-sm font-semibold ${destructive ? 'text-destructive' : 'text-primary-foreground'}`}>
      {label}
    </span>
  </button>
);

export default SideMenu;
