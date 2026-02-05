import { X, Home, Image, Bell, Settings, MessageCircle, Mail, Info, Share2, LogOut, Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

const SideMenu = ({ isOpen, onClose }: SideMenuProps) => {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="fixed left-0 top-0 h-full w-72 bg-sky-dark z-50 shadow-xl flex flex-col">
        {/* Header with hamburger */}
        <div className="p-4">
          <button onClick={onClose} className="text-primary-foreground">
            <Menu className="w-7 h-7" />
          </button>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 px-2">
          <MenuItem icon={Home} label="홈" onClick={() => handleNavigate("/")} />
          <MenuItem icon={Image} label="갤러리" onClick={() => handleNavigate("/camera")} />
          <MenuItem icon={Bell} label="알림 내역" onClick={() => handleNavigate("/")} />
          <MenuItem icon={Settings} label="설정" onClick={() => handleNavigate("/settings")} />
          <MenuItem icon={MessageCircle} label="FAQ" />
          <MenuItem icon={Mail} label="피드백" />
          <MenuItem icon={Info} label="앱 정보" />
          <MenuItem icon={Share2} label="앱 공유" />
          <MenuItem 
            icon={LogOut} 
            label="로그아웃" 
            onClick={handleSignOut}
          />
        </nav>
      </div>
    </>
  );
};

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}

const MenuItem = ({ icon: Icon, label, onClick }: MenuItemProps) => (
  <button
    onClick={onClick}
    className="flex items-center gap-4 w-full px-4 py-4 text-primary-foreground hover:bg-white/10 transition-colors"
  >
    <Icon className="w-6 h-6" />
    <span className="text-lg font-medium">{label}</span>
  </button>
);

export default SideMenu;
