import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import RemoteCommandsPanel from "@/components/RemoteCommandsPanel";
import LocationHistoryModal from "@/components/LocationHistoryModal";
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
  const { t } = useTranslation();

  // ── 1회성 경보 데이터 완전 삭제 (배포 후 제거 가능) ──
  useEffect(() => {
    const NUKE_KEY = 'meercop_nuke_done_v1';
    if (localStorage.getItem(NUKE_KEY)) return;
    console.log("[Index] 🧹 Nuking all alert data...");
    // localStorage 관련 키 전부 삭제
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('meercop_activity') ||
        key.startsWith('meercop_photo') ||
        key.startsWith('meercop_processed') ||
        key.startsWith('meercop_deleted') ||
        key.startsWith('meercop_dismissed') ||
        key.startsWith('meercop_last_stopped')
      )) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // IndexedDB 삭제
    try { indexedDB.deleteDatabase('meercop_photo_alerts'); } catch {}
    try { indexedDB.deleteDatabase('meercop_alert_videos'); } catch {}
    localStorage.setItem(NUKE_KEY, String(Date.now()));
    console.log("[Index] ✅ All alert data nuked, removed", keysToRemove.length, "localStorage keys + IndexedDB");
  }, []);

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

  // 자동 푸시 구독: 디바이스 선택 + 푸시 미구독 시 자동 시도 (S-11: subscribePush를 ref로 안정화)
  const subscribePushRef = useRef(subscribePush);
  subscribePushRef.current = subscribePush;
  useEffect(() => {
    if (selectedDeviceId && pushSupported && !pushSubscribed) {
      subscribePushRef.current();
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
    remoteCommands: false,
    locationHistory: false,
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
        title: t("common.error"),
        description: t("status.statusChangeFailed"),
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
        <div className="text-primary-foreground">{t("common.loading")}</div>
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
            ? t("status.alertDetected")
            : selectedDevice?.status === "offline"
              ? selectedDevice?.is_network_connected === false
                ? t("status.networkDisconnected")
                : t("status.deviceOffline")
              : !selectedDevice?.is_network_connected && selectedDevice
                ? t("status.networkLost")
                : isMonitoring 
                  ? t("status.monitoring")
                  : t("status.ready")
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
        {(showFallbackAlarmButtons || (alarmPlaying && !activeAlert && !latestPhotoAlert && !viewingPhotoAlert && !photoReceiving)) && selectedDevice && !remoteAlarmDismissed && (
          <div className="flex flex-col items-center gap-2">
            {alarmPlaying && (
              <button
              onClick={() => {
                  Alarm.stop();
                  Alarm.suppressFor(30000);
                  if (activeAlert?.id) Alarm.addDismissed(activeAlert.id);
                  if (latestPhotoAlert?.id) Alarm.addDismissed(latestPhotoAlert.id);
                  setAlarmPlaying(false);
                }}
                className="px-5 py-2.5 bg-white/15 backdrop-blur-md text-white border border-white/25 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
              >
                {t("alarm.dismissPhoneAlarm")}
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  await dismissRemoteAlarm();
                  setRemoteAlarmDismissed(true);
                  Alarm.stop();
                  Alarm.suppressFor(30000);
                  setAlarmPlaying(false);
                  toast({ title: t("alarm.computerAlarmDismissed"), description: t("alarm.computerAlarmDismissedDesc") });
                  setShowFallbackAlarmButtons(false);
                } catch (err) {
                  toast({ title: t("common.error"), description: t("alarm.computerAlarmDismissFailed"), variant: "destructive" });
                }
              }}
              className="px-5 py-2.5 bg-destructive text-destructive-foreground rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform flex items-center gap-2"
            >
              {t("alarm.dismissComputerAlarm")}
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

              const broadcastChannelName = `device-commands-${selectedDevice.id}`;
              const existingCh = supabase.getChannels().find(ch => ch.topic === `realtime:${broadcastChannelName}`);
              if (existingCh) supabase.removeChannel(existingCh);
              
              const channel = supabase.channel(broadcastChannelName);
              try {
                await new Promise<void>((resolve) => {
                  const timeout = setTimeout(() => { supabase.removeChannel(channel); resolve(); }, 5000);
                  channel.subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                      clearTimeout(timeout);
                      channel.send({
                        type: "broadcast",
                        event: "camouflage_toggle",
                        payload: { device_id: selectedDevice.id, camouflage_mode: newVal },
                      }).then(() => {
                        supabase.removeChannel(channel);
                        resolve();
                      });
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                      clearTimeout(timeout);
                      supabase.removeChannel(channel);
                      resolve();
                    }
                  });
                });
              } catch { /* best-effort */ }

              toast({
                title: newVal ? t("camouflage.onTitle") : t("camouflage.offTitle"),
                description: newVal ? t("camouflage.onDesc") : t("camouflage.offDesc"),
              });
            } catch {
              toast({ title: t("common.error"), description: t("camouflage.changeFailed"), variant: "destructive" });
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
        onRemoteCommandsClick={() => openPanel("remoteCommands")}
        onLocationHistoryClick={() => openPanel("locationHistory")}
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
            // 사진 경보 ID + 활성 경보 ID 모두 dismissed에 등록
            const photoId = (viewingPhotoAlert || latestPhotoAlert)?.id;
            if (photoId) Alarm.addDismissed(photoId);
            if (activeAlert?.id && activeAlert.id !== photoId) {
              Alarm.addDismissed(activeAlert.id);
            }
            Alarm.stop();
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
              toast({ title: t("alarm.computerAlarmDismissed"), description: t("alarm.computerAlarmDismissedDesc") });
            } catch {
              toast({ title: t("common.error"), description: t("alarm.computerAlarmDismissFailed"), variant: "destructive" });
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

      {/* Remote Commands Panel */}
      <RemoteCommandsPanel
        isOpen={panels.remoteCommands}
        onClose={() => closePanel("remoteCommands")}
        device={selectedDevice}
      />

      {/* Location History Modal */}
      <LocationHistoryModal
        isOpen={panels.locationHistory}
        onClose={() => closePanel("locationHistory")}
        deviceId={selectedDeviceId}
        deviceName={selectedDevice?.name ?? ""}
      />
    </div>
  );
};

export default Index;
