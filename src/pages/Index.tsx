import { useState, useEffect } from "react";
import Header from "@/components/Header";
import DeviceSelector from "@/components/DeviceSelector";
import StatusIcons from "@/components/StatusIcons";
import StatusMessage from "@/components/StatusMessage";
import MeercopCharacter from "@/components/MeercopCharacter";
import ToggleButton from "@/components/ToggleButton";
import SideMenu from "@/components/SideMenu";
import DeviceList from "@/components/DeviceList";

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
  const { alerts, activeAlert, unreadCount, dismissPhoneAlarm, dismissRemoteAlarm, dismissAll } = useAlerts(selectedDeviceId);
  const isMonitoring = selectedDevice?.is_monitoring ?? false;
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
  
  const [phoneAlarmDismissed, setPhoneAlarmDismissed] = useState(false);
  const [remoteAlarmDismissed, setRemoteAlarmDismissed] = useState(false);
  const [showFallbackAlarmButtons, setShowFallbackAlarmButtons] = useState(false);
  const [isPhotoHistoryOpen, setIsPhotoHistoryOpen] = useState(false);


  // 경보 해제 상태 리셋 - activeAlert 또는 새 사진 경보 시
  useEffect(() => {
    if (activeAlert) {
      setPhoneAlarmDismissed(false);
      setRemoteAlarmDismissed(false);
      setShowFallbackAlarmButtons(false);
    } else {
      setShowFallbackAlarmButtons(false);
    }
  }, [activeAlert]);

  useEffect(() => {
    if (latestPhotoAlert) {
      setPhoneAlarmDismissed(false);
      setRemoteAlarmDismissed(false);
      setShowFallbackAlarmButtons(false);
    }
  }, [latestPhotoAlert?.id]);

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

  const handleStatusIconClick = async (type: "laptop" | "meercop" | "network" | "camera" | "settings") => {
    switch (type) {
      case "laptop":
        setIsLocationMapOpen(true);
        break;
      case "camera":
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
      case "settings":
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
      
      {/* Toggle Buttons - highest z-index */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-3">
        {/* 경보 오버레이 닫은 후 해제하지 않은 버튼들 표시 */}
        {showFallbackAlarmButtons && selectedDevice && (
          <>
            {!phoneAlarmDismissed && (
              <button
                onClick={() => {
                  dismissPhoneAlarm();
                  setPhoneAlarmDismissed(true);
                  toast({ title: "경보 해제", description: "스마트폰 경보음이 해제되었습니다." });
                  if (remoteAlarmDismissed) setShowFallbackAlarmButtons(false);
                }}
                className="px-5 py-2.5 bg-destructive text-destructive-foreground rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
              >
                🔕 스마트폰 경보음 해제
              </button>
            )}
            {!remoteAlarmDismissed && (
              <button
                onClick={async () => {
                  try {
                    await dismissRemoteAlarm();
                    setRemoteAlarmDismissed(true);
                    toast({ title: "컴퓨터 경보 해제", description: "컴퓨터의 경보음이 해제되었습니다." });
                    if (phoneAlarmDismissed) setShowFallbackAlarmButtons(false);
                  } catch (err) {
                    toast({ title: "오류", description: "컴퓨터 경보 해제에 실패했습니다.", variant: "destructive" });
                  }
                }}
                className="px-5 py-2.5 bg-destructive text-destructive-foreground rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
              >
                🔇 컴퓨터 경보음 해제
              </button>
            )}
          </>
        )}
        <div className="flex items-center gap-3">
          <ToggleButton 
            isOn={isMonitoring}
            onToggle={handleToggleMonitoring}
          />
          <button
            onClick={async () => {
              if (!selectedDevice) return;
              const currentMeta = (selectedDevice.metadata as Record<string, unknown>) || {};
              const newVal = !currentMeta.camouflage_mode;
              try {
                await supabase
                  .from("devices")
                  .update({ metadata: { ...currentMeta, camouflage_mode: newVal } })
                  .eq("id", selectedDevice.id);
                toast({
                  title: newVal ? "위장 모드 ON" : "위장 모드 OFF",
                  description: newVal ? "노트북 화면이 꺼진 것처럼 보입니다." : "노트북 화면이 정상으로 복원됩니다.",
                });
              } catch {
                toast({ title: "오류", description: "위장 모드 변경 실패", variant: "destructive" });
              }
            }}
            disabled={!selectedDevice}
            className={`flex items-center justify-center w-11 h-11 rounded-full font-bold transition-all shadow-lg ${
              (selectedDevice?.metadata as Record<string, unknown>)?.camouflage_mode
                ? 'bg-gray-900 text-white border-2 border-white/30'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <span className="text-lg">🖥️</span>
          </button>
        </div>
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
            // 해제하지 않은 버튼이 있으면 메인 화면에 표시
            if (!phoneAlarmDismissed || !remoteAlarmDismissed) {
              setShowFallbackAlarmButtons(true);
            }
            if (viewingPhotoAlert) {
              dismissViewingPhoto();
            } else {
              dismissPhotoAlert();
            }
          }}
          receiving={photoReceiving}
          progress={photoProgress}
          phoneAlarmDismissed={phoneAlarmDismissed}
          remoteAlarmDismissed={remoteAlarmDismissed}
          onDismissPhoneAlarm={() => {
            dismissPhoneAlarm();
            setPhoneAlarmDismissed(true);
            toast({ title: "경보 해제", description: "스마트폰 경보음이 해제되었습니다." });
          }}
          onDismissRemoteAlarm={selectedDevice ? async () => {
            try {
              await dismissRemoteAlarm();
              setRemoteAlarmDismissed(true);
              toast({ title: "컴퓨터 경보 해제", description: "컴퓨터의 경보음이 해제되었습니다." });
            } catch {
              toast({ title: "오류", description: "컴퓨터 경보 해제에 실패했습니다.", variant: "destructive" });
            }
          } : undefined}
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
