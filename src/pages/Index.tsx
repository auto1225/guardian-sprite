import { useState, useEffect } from "react";
import Header from "@/components/Header";
import DeviceSelector from "@/components/DeviceSelector";
import StatusIcons from "@/components/StatusIcons";
import StatusMessage from "@/components/StatusMessage";
import MeercopCharacter from "@/components/MeercopCharacter";
import ToggleButton from "@/components/ToggleButton";
import SideMenu from "@/components/SideMenu";
import DeviceList from "@/components/DeviceList";
import AlertMode from "@/components/AlertMode";
import SettingsPage from "@/pages/Settings";
import LocationPage from "@/pages/Location";
import CameraPage from "@/pages/Camera";
import DeviceManagePage from "@/pages/DeviceManage";
import { useDevices } from "@/hooks/useDevices";
import { useAlerts } from "@/hooks/useAlerts";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import mainBg from "@/assets/main-bg.png";

const Index = () => {
  const { devices, selectedDevice, selectedDeviceId, setSelectedDeviceId, isLoading } = useDevices();
  const { alerts, unreadCount } = useAlerts(selectedDeviceId);
  const { toggleMonitoring } = useCommands();
  const { toast } = useToast();

  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false);
  const [isDeviceListExpanded, setIsDeviceListExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isDeviceManageOpen, setIsDeviceManageOpen] = useState(false);
  const [isAlertMode, setIsAlertMode] = useState(false);

  const isMonitoring = selectedDevice?.is_monitoring ?? false;

  // Check for active alerts
  const latestAlert = alerts.find((a) => !a.is_read && a.alert_type === "intrusion");
  
  useEffect(() => {
    if (latestAlert && selectedDevice?.status === "alert") {
      setIsAlertMode(true);
    }
  }, [latestAlert, selectedDevice?.status]);

  const handleToggleMonitoring = async () => {
    if (!selectedDevice) return;
    
    try {
      await toggleMonitoring(selectedDevice.id, !isMonitoring);
      toast({
        title: isMonitoring ? "감시 중지" : "감시 시작",
        description: isMonitoring 
          ? "노트북 감시가 중지되었습니다." 
          : "노트북 감시가 시작되었습니다.",
      });
    } catch (error) {
      toast({
        title: "오류",
        description: "상태 변경에 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleStatusIconClick = (type: "laptop" | "meercop" | "network" | "camera") => {
    switch (type) {
      case "laptop":
        setIsLocationOpen(true);
        break;
      case "camera":
        setIsCameraOpen(true);
        break;
      case "meercop":
        if (selectedDevice) {
          setIsSettingsOpen(true);
        }
        break;
    }
  };

  // Show loading or empty state
  if (isLoading) {
    return (
      <div className="h-screen bg-gradient-to-b from-sky-light to-primary flex items-center justify-center">
        <div className="text-primary-foreground">로딩 중...</div>
      </div>
    );
  }

  // Alert mode overlay
  if (isAlertMode && selectedDevice && latestAlert) {
    return (
      <AlertMode
        device={selectedDevice}
        latestAlert={latestAlert}
        onDismiss={() => setIsAlertMode(false)}
      />
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden">
      {/* Full screen background */}
      <img 
        src={mainBg} 
        alt="Background" 
        className="absolute inset-0 w-full h-full object-cover z-0"
      />
      
      {/* Content overlay */}
      <div className="relative z-10 flex flex-col h-full">
      <Header
        onMenuClick={() => setIsSideMenuOpen(true)}
        onDeviceManageClick={() => setIsDeviceManageOpen(true)}
        unreadCount={unreadCount}
        deviceId={selectedDeviceId}
      />
      
      
      <DeviceList 
        isExpanded={isDeviceListExpanded}
        onToggle={() => setIsDeviceListExpanded(!isDeviceListExpanded)}
      />
      
      <StatusIcons 
        device={selectedDevice}
        onIconClick={handleStatusIconClick}
      />
      
      <MeercopCharacter 
        isMonitoring={isMonitoring} 
        isAlert={selectedDevice?.status === "alert"}
        statusMessage={
          selectedDevice?.status === "alert" 
            ? "노트북에 충격이 감지되었습니다!"
            : isMonitoring 
              ? "미어캅이 당신의 노트북을 감시중입니다."
              : "미어캅 감시 준비 완료! 언제든지 감시를 시작할 수 있습니다."
        }
      />
      
      <ToggleButton 
        isOn={isMonitoring}
        onToggle={handleToggleMonitoring}
      />

      {/* Side Menu */}
      <SideMenu 
        isOpen={isSideMenuOpen}
        onClose={() => setIsSideMenuOpen(false)}
      />

      {/* Settings Page */}
      {selectedDevice && (
        <SettingsPage
          device={selectedDevice}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Location Page */}
      {selectedDevice && (
        <LocationPage
          device={selectedDevice}
          isOpen={isLocationOpen}
          onClose={() => setIsLocationOpen(false)}
        />
      )}

      {/* Camera Page */}
      {selectedDevice && (
        <CameraPage
          device={selectedDevice}
          isOpen={isCameraOpen}
          onClose={() => setIsCameraOpen(false)}
        />
      )}

      {/* Device Management Page */}
      <DeviceManagePage
        isOpen={isDeviceManageOpen}
        onClose={() => setIsDeviceManageOpen(false)}
        onSelectDevice={setSelectedDeviceId}
      />
      </div>
    </div>
  );
};

export default Index;
