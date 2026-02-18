import { useState, useEffect } from "react";
import AlertMode from "@/components/AlertMode";
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
import HelpPage from "@/pages/Help";
import { useDevices } from "@/hooks/useDevices";
import * as Alarm from "@/lib/alarmSound";
import { useAlerts } from "@/hooks/useAlerts";
import { useCommands } from "@/hooks/useCommands";
import { usePhotoReceiver } from "@/hooks/usePhotoReceiver";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useDeviceHeartbeat } from "@/hooks/useDeviceHeartbeat";
import { useLocationResponder } from "@/hooks/useLocationResponder";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";

const Index = () => {
  const { devices, selectedDevice, selectedDeviceId, setSelectedDeviceId, isLoading, refreshDeviceStatus } = useDevices();
  const nonSmartphoneDevices = devices.filter(d => d.device_type !== "smartphone");
  const deviceNameMap = Object.fromEntries(nonSmartphoneDevices.map(d => [d.id, d.name]));
  const { alerts, activeAlert, unreadCount, dismissRemoteAlarm, dismissAll } = useAlerts(selectedDeviceId);
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, subscribe: subscribePush } = usePushSubscription(selectedDeviceId);
  const isMonitoring = selectedDevice?.is_monitoring ?? false;
  const { toggleMonitoring } = useCommands();
  const { toast } = useToast();

  // 상태 하트비트 & 위치 응답 로직
  useDeviceHeartbeat();
  useLocationResponder();

  // 자동 푸시 구독: 디바이스 선택 + 푸시 미구독 시 자동 시도
  useEffect(() => {
    if (selectedDeviceId && pushSupported && !pushSubscribed) {
      subscribePush();
    }
  }, [selectedDeviceId, pushSupported, pushSubscribed]);
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
  } = usePhotoReceiver(selectedDeviceId, deviceNameMap);

  // UI 패널 상태 그룹화 (S-8: 리렌더링 최적화)
  const [panels, setPanels] = useState({
    sideMenu: false,
    deviceList: false,
    settings: false,
    location: false,
    locationMap: false,
    camera: false,
    networkInfo: false,
    deviceManage: false,
    photoHistory: false,
    help: false,
  });
  const openPanel = (key: keyof typeof panels) => setPanels(p => ({ ...p, [key]: true }));
  const closePanel = (key: keyof typeof panels) => setPanels(p => ({ ...p, [key]: false }));

  const [remoteAlarmDismissed, setRemoteAlarmDismissed] = useState(false);
  const [showFallbackAlarmButtons, setShowFallbackAlarmButtons] = useState(false);
  const [alarmPlaying, setAlarmPlaying] = useState(false);


  // 경보음 재생 상태 주기적 체크 — 컴포넌트 재마운트 후에도 폴백 버튼 표시
  useEffect(() => {
    const checkAlarm = () => setAlarmPlaying(Alarm.isPlaying());
    checkAlarm();
    const id = setInterval(checkAlarm, 1000);
    return () => clearInterval(id);
  }, []);

  // 경보 해제 상태 리셋
  useEffect(() => {
    if (activeAlert) {
      setRemoteAlarmDismissed(false);
      setShowFallbackAlarmButtons(false);
    } else {
      setShowFallbackAlarmButtons(false);
    }
  }, [activeAlert]);

  useEffect(() => {
    if (latestPhotoAlert) {
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
        openPanel("locationMap");
        break;
      case "camera":
        if (selectedDeviceId) {
          await refreshDeviceStatus(selectedDeviceId);
        }
        openPanel("camera");
        break;
      case "meercop":
        if (selectedDevice) {
          openPanel("settings");
        }
        break;
      case "network":
        openPanel("networkInfo");
        break;
      case "settings":
        if (selectedDevice) {
          openPanel("settings");
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
            ? "🚨 노트북에 충격이 감지되었습니다!"
            : selectedDevice?.status === "offline"
              ? selectedDevice?.is_network_connected === false
                ? "⚠️ 컴퓨터가 네트워크에 연결되어 있지 않습니다. Wi-Fi 또는 LAN 연결을 확인해 주세요. 감시 기능이 작동하지 않습니다."
                : "⚠️ 컴퓨터와 연결할 수 없습니다. 컴퓨터가 꺼져 있거나 절전 모드일 수 있습니다. 감시 기능이 작동하지 않습니다."
              : !selectedDevice?.is_network_connected && selectedDevice
                ? "⚠️ 컴퓨터의 네트워크 연결이 끊어졌습니다. 일부 원격 기능이 제한될 수 있습니다."
                : isMonitoring 
                  ? "미어캅이 당신의 노트북을 감시중입니다."
                  : "미어캅 감시 준비 완료! 언제든지 감시를 시작할 수 있습니다."
        }
      />
      
      {/* UI Layer - positioned above scene */}
      <div className="absolute inset-0 z-10 flex flex-col pointer-events-none">
        <div className="pointer-events-auto">
          <Header
            onMenuClick={() => openPanel("sideMenu")}
            onDeviceManageClick={() => openPanel("deviceManage")}
            unreadCount={unreadCount}
            deviceId={selectedDeviceId}
            onViewPhoto={(alert) => {
              viewPhotoAlert(alert);
            }}
          />
        </div>
        
        <div className="pointer-events-auto">
          <DeviceList 
            isExpanded={panels.deviceList}
            onToggle={() => setPanels(p => ({ ...p, deviceList: !p.deviceList }))}
            selectedDeviceId={selectedDeviceId}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDeviceId}
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
      <div className="absolute bottom-6 left-0 right-0 z-20 flex flex-col items-center gap-3 px-4">
        {/* 경보음이 재생 중이거나, 경보 오버레이 닫은 후 컴퓨터 해제 버튼 표시 */}
        {(showFallbackAlarmButtons || (alarmPlaying && !activeAlert && !latestPhotoAlert && !viewingPhotoAlert)) && selectedDevice && !remoteAlarmDismissed && (
          <div className="flex flex-col items-center gap-2">
            {alarmPlaying && (
              <button
                onClick={() => {
                  Alarm.stop();
                  if (activeAlert?.id) Alarm.addDismissed(activeAlert.id);
                  setAlarmPlaying(false);
                }}
                className="px-5 py-2.5 bg-white/15 backdrop-blur-md text-white border border-white/25 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
              >
                🔕 스마트폰 경보음 해제
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  await dismissRemoteAlarm();
                  setRemoteAlarmDismissed(true);
                  Alarm.stop();
                  setAlarmPlaying(false);
                  toast({ title: "컴퓨터 경보 해제", description: "컴퓨터의 경보음이 해제되었습니다." });
                  setShowFallbackAlarmButtons(false);
                } catch (err) {
                  toast({ title: "오류", description: "컴퓨터 경보 해제에 실패했습니다.", variant: "destructive" });
                }
              }}
              className="px-5 py-2.5 bg-destructive text-destructive-foreground rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
            >
              🔇 컴퓨터 경보음 해제
            </button>
          </div>
        )}
        <ToggleButton 
          isOn={isMonitoring}
          onToggle={handleToggleMonitoring}
          isCamouflage={!!(selectedDevice?.metadata as Record<string, unknown>)?.camouflage_mode}
          onCamouflageToggle={selectedDevice ? async () => {
            const currentMeta = (selectedDevice.metadata as Record<string, unknown>) || {};
            const newVal = !currentMeta.camouflage_mode;
            try {
              await safeMetadataUpdate(selectedDevice.id, { camouflage_mode: newVal });

              const channel = supabase.channel(`device-commands-${selectedDevice.id}`);
              await channel.subscribe((status) => {
                if (status === "SUBSCRIBED") {
                  channel.send({
                    type: "broadcast",
                    event: "camouflage_toggle",
                    payload: { device_id: selectedDevice.id, camouflage_mode: newVal },
                  }).then(() => {
                    supabase.removeChannel(channel);
                  });
                }
              });

              toast({
                title: newVal ? "위장 모드 ON" : "위장 모드 OFF",
                description: newVal ? "노트북 화면이 꺼진 것처럼 보입니다." : "노트북 화면이 정상으로 복원됩니다.",
              });
            } catch {
              toast({ title: "오류", description: "위장 모드 변경 실패", variant: "destructive" });
            }
          } : undefined}
        />
      </div>

      {/* Side Menu */}
      <SideMenu 
        isOpen={panels.sideMenu}
        onClose={() => closePanel("sideMenu")}
        onPhotoHistoryClick={() => openPanel("photoHistory")}
        onHelpClick={() => openPanel("help")}
      />

      {/* Settings Page */}
      {selectedDevice && (
        <SettingsPage
          devices={devices.filter(d => d.device_type !== "smartphone")}
          initialDeviceId={selectedDevice.id}
          isOpen={panels.settings}
          onClose={() => closePanel("settings")}
        />
      )}

      {/* Location Page */}
      {selectedDevice && (
        <LocationPage
          device={selectedDevice}
          isOpen={panels.location}
          onClose={() => closePanel("location")}
        />
      )}

      {/* Camera Page */}
      {selectedDevice && (
        <CameraPage
          device={selectedDevice}
          isOpen={panels.camera}
          onClose={() => closePanel("camera")}
        />
      )}

      {/* Location Map Modal */}
      <LocationMapModal
        isOpen={panels.locationMap}
        onClose={() => closePanel("locationMap")}
        deviceId={selectedDeviceId}
        deviceName={selectedDevice?.name ?? ""}
      />

      {/* Network Info Modal */}
      <NetworkInfoModal
        isOpen={panels.networkInfo}
        onClose={() => closePanel("networkInfo")}
        deviceId={selectedDeviceId}
        deviceName={selectedDevice?.name ?? ""}
      />

      {/* Device Management Page */}
      <DeviceManagePage
        isOpen={panels.deviceManage}
        onClose={() => closePanel("deviceManage")}
        onSelectDevice={setSelectedDeviceId}
        onViewAlertHistory={(deviceId) => {
          setSelectedDeviceId(deviceId);
          closePanel("deviceManage");
          openPanel("photoHistory");
        }}
      />

      {/* Alert Mode Overlay */}
      {activeAlert && !latestPhotoAlert && !viewingPhotoAlert && (
        <AlertMode
          device={selectedDevice!}
          activeAlert={activeAlert}
          onDismiss={() => {
            dismissAll();
            setShowFallbackAlarmButtons(false);
          }}
          onSendRemoteAlarmOff={async () => {
            await dismissRemoteAlarm();
            setRemoteAlarmDismissed(true);
          }}
        />
      )}

      {/* Photo Alert Overlay */}
      {(latestPhotoAlert || viewingPhotoAlert) && (
        <PhotoAlertOverlay
          alert={(viewingPhotoAlert || latestPhotoAlert)!}
          isHistoryView={!!viewingPhotoAlert && !latestPhotoAlert}
          onDismiss={() => {
            if (!remoteAlarmDismissed) {
              setShowFallbackAlarmButtons(true);
            }
            if (viewingPhotoAlert) {
              dismissViewingPhoto();
            } else {
              dismissPhotoAlert();
            }
            dismissAll();
          }}
          receiving={photoReceiving}
          progress={photoProgress}
          remoteAlarmDismissed={remoteAlarmDismissed}
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
        isOpen={panels.photoHistory}
        onClose={() => closePanel("photoHistory")}
        alerts={photoAlerts}
        onViewAlert={(alert) => {
          closePanel("photoHistory");
          viewPhotoAlert(alert);
        }}
        onDeleteAlert={removePhotoAlert}
      />

      {/* Help Page */}
      <HelpPage
        isOpen={panels.help}
        onClose={() => closePanel("help")}
      />
    </div>
  );
};

export default Index;
