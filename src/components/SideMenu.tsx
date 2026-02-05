import { X, User, Share2, HelpCircle, Mail, Info, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

const SideMenu = ({ isOpen, onClose }: SideMenuProps) => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "로그아웃",
      description: "안전하게 로그아웃되었습니다.",
    });
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
      <div className="fixed left-0 top-0 h-full w-72 bg-sidebar z-50 shadow-xl flex flex-col">
        {/* Header */}
        <div className="bg-primary p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-foreground/20 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-primary-foreground font-semibold text-sm truncate max-w-[160px]">
                {user?.email}
              </p>
              <p className="text-primary-foreground/70 text-xs">Normal member</p>
            </div>
          </div>
          <button onClick={onClose} className="text-primary-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Items */}
        <div className="flex-1 py-2">
          <MenuItem icon={Share2} label="앱 공유" />
          <MenuItem icon={HelpCircle} label="Q&A" />
          <MenuItem icon={Mail} label="문의" />
          <MenuItem icon={Info} label="앱 정보" />
        </div>

        {/* Logout */}
        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-4 py-3 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">로그아웃</span>
          </button>
        </div>
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
    className="flex items-center gap-3 w-full px-4 py-3 text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
  >
    <Icon className="w-5 h-5" />
    <span className="font-medium">{label}</span>
  </button>
);

export default SideMenu;
