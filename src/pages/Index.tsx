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
import LocationMapModal from "@/components/LocationMapModal";
import NetworkInfoModal from "@/components/NetworkInfoModal";
import CameraPage from "@/pages/Camera";
import DeviceManagePage from "@/pages/DeviceManage";
import PhotoAlertOverlay from "@/components/PhotoAlertOverlay";
import PhotoAlertHistory from "@/components/PhotoAlertHistory";
import { useDevices } from "@/hooks/useDevices";
import { useAlerts } from "@/hooks/useAlerts";
import { useCommands } from "@/hooks/useCommands";
import { usePhotoReceiver } from "@/hooks/usePhotoReceiver";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { devices, selectedDevice, selectedDeviceId, setSelectedDeviceId, isLoading, refreshDeviceStatus } = useDevices();
  const { alerts, activeAlert, unreadCount, dismissActiveAlert } = useAlerts(selectedDeviceId);
  const { toggleMonitoring } = useCommands();
  const { toast } = useToast();
  const {
    receiving: photoReceiving,
    progress: photoProgress,
    latestAlert: latestPhotoAlert,
    alerts: photoAlerts,
    dismissLatest: dismissPhotoAlert,
    viewAlert: viewPhotoAlert,
    viewingAlert: viewingPhotoAlert,
    dismissViewing: dismissViewingPhoto,
    removeAlert: removePhotoAlert,
  } = usePhotoReceiver(selectedDeviceId);

  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false);
  const [isDeviceListExpanded, setIsDeviceListExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [isLocationMapOpen, setIsLocationMapOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isNetworkInfoOpen, setIsNetworkInfoOpen] = useState(false);
  const [isDeviceManageOpen, setIsDeviceManageOpen] = useState(false);
  const [isAlertMode, setIsAlertMode] = useState(false);
  const [isPhotoHistoryOpen, setIsPhotoHistoryOpen] = useState(false);

  const isMonitoring = selectedDevice?.is_monitoring ?? false;

  // Check for active alerts (Presence 기반)
  useEffect(() => {
    if (activeAlert) {
      setIsAlertMode(true);
    }
  }, [activeAlert]);

  const handleToggleMonitoring = async () => {
    if (!selectedDevice) return;
    
    try {
      await toggleMonitoring(selectedDevice.id, !isMonitoring);
    } catch (error) {
      toast({
        title: "오류",
        description: "상태 변경에 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleStatusIconClick = async (type: "laptop" | "meercop" | "network" | "camera") => {
    switch (type) {
      case "laptop":
        setIsLocationMapOpen(true);
        break;
      case "camera":
        // 카메라 페이지 열기 전 최신 상태 새로고침
        if (selectedDeviceId) {
          await refreshDeviceStatus(selectedDeviceId);
        }
        setIsCameraOpen(true);
        break;
      case "meercop":
        if (selectedDevice) {
          setIsSettingsOpen(true);
        }
        break;
      case "network":
        setIsNetworkInfoOpen(true);
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

  // Alert mode overlay (Presence 기반 activeAlert)
  if (isAlertMode && selectedDevice && activeAlert) {
    return (
      <AlertMode
        device={selectedDevice}
        activeAlert={activeAlert}
        onDismiss={() => {
          setIsAlertMode(false);
          dismissActiveAlert();
        }}
      />
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden">
      {/* Scene Container - Mountain + Character (aspect ratio preserved) */}
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
      
      {/* UI Layer - positioned above scene */}
      <div className="absolute inset-0 z-10 flex flex-col pointer-events-none">
        <div className="pointer-events-auto">
          <Header
            onMenuClick={() => setIsSideMenuOpen(true)}
            onDeviceManageClick={() => setIsDeviceManageOpen(true)}
            unreadCount={unreadCount}
            deviceId={selectedDeviceId}
          />
        </div>
        
        <div className="pointer-events-auto">
          <DeviceList 
            isExpanded={isDeviceListExpanded}
            onToggle={() => setIsDeviceListExpanded(!isDeviceListExpanded)}
          />
        </div>
        
        <div className="pointer-events-auto">
          <StatusIcons 
            device={selectedDevice}
            onIconClick={handleStatusIconClick}
          />
        </div>
      </div>
      
      {/* Toggle Button - highest z-index */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <ToggleButton 
          isOn={isMonitoring}
          onToggle={handleToggleMonitoring}
        />
      </div>

      {/* Side Menu */}
      <SideMenu 
        isOpen={isSideMenuOpen}
        onClose={() => setIsSideMenuOpen(false)}
        onPhotoHistoryClick={() => setIsPhotoHistoryOpen(true)}
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

      {/* Location Map Modal */}
      <LocationMapModal
        isOpen={isLocationMapOpen}
        onClose={() => setIsLocationMapOpen(false)}
        deviceId={selectedDeviceId}
        deviceName={selectedDevice?.name ?? ""}
      />

      {/* Network Info Modal */}
      <NetworkInfoModal
        isOpen={isNetworkInfoOpen}
        onClose={() => setIsNetworkInfoOpen(false)}
        deviceId={selectedDeviceId}
        deviceName={selectedDevice?.name ?? ""}
      />

      {/* Device Management Page */}
      <DeviceManagePage
        isOpen={isDeviceManageOpen}
        onClose={() => setIsDeviceManageOpen(false)}
        onSelectDevice={setSelectedDeviceId}
      />

      {/* Photo Alert Overlay */}
      {(latestPhotoAlert || viewingPhotoAlert) && (
        <PhotoAlertOverlay
          alert={(viewingPhotoAlert || latestPhotoAlert)!}
          onDismiss={() => {
            if (viewingPhotoAlert) {
              dismissViewingPhoto();
            } else {
              dismissPhotoAlert();
            }
          }}
          receiving={photoReceiving}
          progress={photoProgress}
        />
      )}

      {/* Photo Alert History */}
      <PhotoAlertHistory
        isOpen={isPhotoHistoryOpen}
        onClose={() => setIsPhotoHistoryOpen(false)}
        alerts={photoAlerts}
        onViewAlert={(alert) => {
          setIsPhotoHistoryOpen(false);
          viewPhotoAlert(alert);
        }}
        onDeleteAlert={removePhotoAlert}
      />
    </div>
  );
};

export default Index;
