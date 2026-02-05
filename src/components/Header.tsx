import { Menu, Bell, Plus, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface HeaderProps {
  onMenuClick?: () => void;
}

const Header = ({ onMenuClick }: HeaderProps) => {
  const { signOut } = useAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "로그아웃",
      description: "안전하게 로그아웃되었습니다.",
    });
  };

  return (
    <header className="flex items-center justify-between px-4 py-3">
      <button className="p-2 text-primary-foreground" onClick={onMenuClick}>
        <Menu className="w-6 h-6" />
      </button>
      
      <div className="flex flex-col items-center">
        <span className="text-primary-foreground font-bold text-xl tracking-wide" style={{ fontFamily: 'system-ui' }}>
          <span className="italic">Meer</span>
        </span>
        <span className="text-primary-foreground font-black text-lg -mt-1">COP</span>
      </div>
      
      <div className="flex items-center gap-2">
        <button className="p-2 text-primary-foreground relative">
          <Bell className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
            2
          </span>
        </button>
        <button className="p-2 text-primary-foreground">
          <Plus className="w-6 h-6" />
        </button>
        <button className="p-2 text-primary-foreground" onClick={handleSignOut}>
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

export default Header;