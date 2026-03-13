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
import LegalPage from "@/pages/Legal";
import { useDevices } from "@/hooks/useDevices";
import * as Alarm from "@/lib/alarmSound";
import { useAlerts } from "@/hooks/useAlerts";
import { useCommands } from "@/hooks/useCommands";
import { usePhotoReceiver } from "@/hooks/usePhotoReceiver";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useDeviceHeartbeat } from "@/hooks/useDeviceHeartbeat";
import { useLocationResponder } from "@/hooks/useLocationResponder";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useAppStabilizer } from "@/hooks/useAppStabilizer";
import { useSmartphoneRegistration } from "@/hooks/useSmartphoneRegistration";
import { useAuth } from "@/hooks/useAuth";
import { broadcastCommand } from "@/lib/broadcastCommand";
import { useLicenseGuard } from "@/hooks/useLicenseGuard";
import LicenseExpiredOverlay from "@/components/LicenseExpiredOverlay";
import { useCapabilityGuard } from "@/hooks/useCapabilityGuard";
import PermissionRequestPopup from "@/components/PermissionRequestPopup";

import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { waitForCommandAck } from "@/lib/commandAck";
import { safeStorage } from "@/lib/safeStorage";

const Index = () => {
  const { t } = useTranslation();
  const { effectiveUserId } = useAuth();
  const { expired: licenseExpired } = useLicenseGuard();


  // 스마트폰 자동 등록
  useSmartphoneRegistration();

  const { devices, selectedDevice, selectedDeviceId, setSelectedDeviceId, isLoading, refreshDeviceStatus } = useDevices();
  const managedDevices = devices.filter(d => {
    if (d.device_type !== "smartphone") return true;
    return !!(d.metadata as Record<string, unknown>)?.serial_key;
  });
  const deviceNameMap = Object.fromEntries(managedDevices.map(d => [d.id, d.name]));
  const { alerts, activeAlert, unreadCount, dismissRemoteAlarm, dismissAll } = useAlerts(selectedDeviceId);
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, subscribe: subscribePush } = usePushSubscription(selectedDeviceId);
  // ★ 기기가 오프라인이면 is_monitoring이 DB에서 true여도 UI에서는 OFF로 표시
  const isDeviceOnline = selectedDevice?.status !== "offline";
  const isMonitoring = isDeviceOnline && (selectedDevice?.is_monitoring ?? false);
  const selectedSerialKey = selectedDevice?.metadata ? (selectedDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined : undefined;

  // ★ 버튼 전용 로컬 낙관적 상태 — 버튼은 즉시 토글, pill/badge는 Realtime 반영
  const [optimisticMonitoring, setOptimisticMonitoring] = useState<boolean | null>(null);
  const [optimisticCamouflage, setOptimisticCamouflage] = useState<boolean | null>(null);

  // 실제 기기 상태가 변하면 낙관적 상태 리셋
  useEffect(() => {
    setOptimisticMonitoring(null);
  }, [selectedDevice?.is_monitoring, selectedDevice?.status]);

  useEffect(() => {
    setOptimisticCamouflage(null);
  }, [(selectedDevice?.metadata as Record<string, unknown>)?.camouflage_mode, selectedDevice?.status]);

  // 기기 변경 시 낙관적 상태 리셋
  useEffect(() => {
    setOptimisticMonitoring(null);
    setOptimisticCamouflage(null);
  }, [selectedDeviceId]);

  // 버튼에 표시할 값: 낙관적 상태가 있으면 사용, 없으면 실제 상태
  const buttonMonitoring = optimisticMonitoring !== null ? optimisticMonitoring : isMonitoring;
  const buttonCamouflage = optimisticCamouflage !== null ? optimisticCamouflage : (isDeviceOnline && !!(selectedDevice?.metadata as Record<string, unknown>)?.camouflage_mode);
  const { guard } = useCapabilityGuard(selectedSerialKey);
  const { toggleMonitoring } = useCommands();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 상태 하트비트 & 위치 응답 & 안정화 로직
  useDeviceHeartbeat();
  useLocationResponder();
  useWakeLock(isMonitoring);
  useAppStabilizer();

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
    legal: false,
    remoteCommands: false,
    locationHistory: false,
  });
  const openPanel = (key: keyof typeof panels) => setPanels(p => ({ ...p, [key]: true }));
  const closePanel = (key: keyof typeof panels) => setPanels(p => ({ ...p, [key]: false }));

  const [remoteAlarmDismissed, setRemoteAlarmDismissed] = useState(false);
  const [bgVersion, setBgVersion] = useState(0);
  const [mascotVisible, setMascotVisible] = useState(() => safeStorage.getItem("meercop-mascot-visible") !== "false");
  const [showFallbackAlarmButtons, setShowFallbackAlarmButtons] = useState(false);
  const [alarmPlaying, setAlarmPlaying] = useState(false);


  // 경보음 재생 상태 주기적 체크 — 컴포넌트 재마운트 후에도 폴백 버튼 표시
  useEffect(() => {
    const checkAlarm = () => setAlarmPlaying(Alarm.isPlaying());
    checkAlarm();
    const id = setInterval(checkAlarm, 1000);
    return () => clearInterval(id);
  }, []);

  // ★ 경보 발생 시 기기 정보를 ref에 캡처 — 이후 selectedDevice가 변해도 유지
  const alertDeviceInfoRef = useRef<{ name: string; serial: string | null } | null>(null);

  // 경보 발생 시 기기 정보 캡처 — 경보의 device_id로 정확한 기기 식별
  // devices 로드 전이면 ref를 설정하지 않아 다음 렌더에서 재시도
  useEffect(() => {
    if (activeAlert) {
      setRemoteAlarmDismissed(false);
      setShowFallbackAlarmButtons(false);
      // ★ ref가 없거나 이름이 비어있으면 재시도 — devices 로딩 완료 후 캡처
      if (!alertDeviceInfoRef.current || !alertDeviceInfoRef.current.name) {
        const alertSourceDevice = activeAlert.device_id
          ? devices.find(d => d.id === activeAlert.device_id)
          : selectedDevice;
        const targetDevice = alertSourceDevice || selectedDevice;
        if (targetDevice) {
          const meta = targetDevice.metadata as Record<string, unknown> | null;
          alertDeviceInfoRef.current = {
            name: targetDevice.name,
            serial: meta?.serial_key ? String(meta.serial_key) : null,
          };
        }
      }
    }
  }, [activeAlert, selectedDevice, devices]);

  useEffect(() => {
    if (latestPhotoAlert) {
      setRemoteAlarmDismissed(false);
      setShowFallbackAlarmButtons(false);
    }
  }, [latestPhotoAlert?.id]);

  const handleToggleMonitoring = async () => {
    if (!selectedDevice) return;
    // ★ 기기가 오프라인이면 감시 토글 불가
    if (selectedDevice.status === "offline") {
      toast({
        title: t("status.deviceOffline"),
        description: t("status.deviceOfflineActionDesc", "컴퓨터가 로그아웃 또는 오프라인 상태이므로 연결할 수 없습니다."),
        variant: "destructive",
      });
      return;
    }
    if (!guard("monitoring_toggle")) return;
    const newVal = !buttonMonitoring;
    // ★ 버튼 즉시 토글
    setOptimisticMonitoring(newVal);

    try {
      const monitorSerialKey = (selectedDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined;
      await toggleMonitoring(selectedDevice.id, newVal, monitorSerialKey, selectedDevice.name);
      
      // 명령 전송 성공 토스트 — UI는 실제 기기가 DB를 업데이트할 때 Realtime으로 반영됨
      toast({
        title: newVal ? t("commandAck.monitoringOnSent") : t("commandAck.monitoringOffSent"),
        description: t("commandAck.waitingForDevice"),
      });

      // ACK 대기 (노트북 응답 확인)
      if (effectiveUserId) {
        const serialKey = (selectedDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined;
        waitForCommandAck({
          deviceId: selectedDevice.id,
          deviceName: selectedDevice.name,
          serialKey,
          event: "monitoring_toggle",
        }).then((acked) => {
          if (acked) {
            toast({
              title: newVal ? t("commandAck.monitoringOnConfirmed") : t("commandAck.monitoringOffConfirmed"),
              description: t("commandAck.commandConfirmedDesc"),
            });
          } else {
            toast({
              title: t("commandAck.commandTimeout"),
              description: t("commandAck.commandTimeoutDesc"),
              variant: "destructive",
            });
          }
        });
      }
    } catch (error) {
      toast({
        title: t("common.error"),
        description: t("status.statusChangeFailed"),
        variant: "destructive",
      });
    }
  };

  const handleStatusIconClick = async (type: "laptop" | "meercop" | "network" | "camera" | "settings") => {
    if (!selectedDevice) {
      toast({ title: t("common.noDevice"), description: t("common.noDeviceDesc") });
      return;
    }
    // 설정 외의 아이콘은 기기가 오프라인이면 연결 불가 알림
    if (type !== "settings" && type !== "meercop" && selectedDevice.status === "offline") {
      toast({
        title: t("status.deviceOffline"),
        description: t("status.deviceOfflineActionDesc", "컴퓨터가 로그아웃 또는 오프라인 상태이므로 연결할 수 없습니다."),
      });
      return;
    }
    switch (type) {
      case "laptop":
        if (!guard("location_tracking")) return;
        openPanel("locationMap");
        break;
      case "camera":
        if (!guard("camera_view")) return;
        openPanel("camera");
        break;
      case "meercop":
      case "settings":
        openPanel("settings");
        break;
      case "network":
        if (!guard("network_info")) return;
        openPanel("networkInfo");
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
    <div className="min-h-screen min-h-[100svh] flex flex-col relative overflow-hidden bg-background">
      {/* Scene Container - Mountain + Character (aspect ratio preserved) */}
      <MeercopCharacter 
        isMonitoring={isMonitoring} 
        isAlert={selectedDevice?.status === "alert"}
        bgVersion={bgVersion}
        hideCharacter={!mascotVisible}
        statusMessage={
          selectedDevice?.status === "alert" 
            ? t("status.alertDetected")
            : selectedDevice?.status === "offline"
              ? (selectedDevice?.metadata as Record<string, unknown>)?.logged_out
                ? t("status.deviceLoggedOut")
                : selectedDevice?.is_network_connected === false
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
                   Alarm.suppressFor(5000);
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
                  Alarm.suppressFor(5000);
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
          isOn={buttonMonitoring}
          onToggle={handleToggleMonitoring}
          isCamouflage={buttonCamouflage}
          onCamouflageToggle={selectedDevice ? async () => {
            // ★ 기기가 오프라인이면 위장모드 토글 불가
            if (selectedDevice.status === "offline") {
              toast({
                title: t("status.deviceOffline"),
                description: t("status.deviceOfflineActionDesc", "컴퓨터가 로그아웃 또는 오프라인 상태이므로 연결할 수 없습니다."),
                variant: "destructive",
              });
              return;
            }
            if (!guard("camouflage_mode")) return;
            const newVal = !buttonCamouflage;
            // ★ 버튼 즉시 토글
            setOptimisticCamouflage(newVal);
            try {
              await safeMetadataUpdate(selectedDevice.id, { camouflage_mode: newVal });

              // ★ 낙관적 업데이트 제거 — 실제 기기가 DB를 업데이트할 때 Realtime으로 반영
              if (effectiveUserId) {
                const serialKey = (selectedDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined;
                await broadcastCommand({
                  userId: effectiveUserId,
                  event: "camouflage_toggle",
                  payload: { device_id: selectedDevice.id, camouflage_mode: newVal, serial_key: serialKey },
                });
              }

              toast({
                title: newVal ? t("camouflage.onTitle") : t("camouflage.offTitle"),
                description: t("commandAck.waitingForDevice"),
              });

              // ACK 대기
              if (effectiveUserId) {
                const ackSerialKey = (selectedDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined;
                waitForCommandAck({
                  deviceId: selectedDevice.id,
                  deviceName: selectedDevice.name,
                  serialKey: ackSerialKey,
                  event: "camouflage_toggle",
                }).then((acked) => {
                  if (acked) {
                    toast({
                      title: newVal ? t("commandAck.camouflageOnConfirmed") : t("commandAck.camouflageOffConfirmed"),
                      description: t("commandAck.commandConfirmedDesc"),
                    });
                  } else {
                    toast({
                      title: t("commandAck.commandTimeout"),
                      description: t("commandAck.commandTimeoutDesc"),
                      variant: "destructive",
                    });
                  }
                });
              }
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
        onHelpClick={() => openPanel("help")}
        onLegalClick={() => openPanel("legal")}
      />

      {/* Settings Page */}
      {panels.settings && selectedDevice && (
        <SettingsPage
          devices={managedDevices}
          initialDeviceId={selectedDevice.id}
          isOpen={panels.settings}
          onClose={() => closePanel("settings")}
          onDeviceChange={(id) => setSelectedDeviceId(id)}
          onBackgroundChange={() => setBgVersion(v => v + 1)}
          onMascotChange={() => setMascotVisible(safeStorage.getItem("meercop-mascot-visible") !== "false")}
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

      {/* Alert Mode Overlay — key 고정으로 리마운트 방지 */}
      {activeAlert && selectedDevice && (() => {
        // ★ 경보 발생 기기를 정확히 식별 — selectedDevice가 아닌 실제 경보 소스 기기 사용
        const alertSourceDevice = activeAlert.device_id
          ? devices.find(d => d.id === activeAlert.device_id) || selectedDevice
          : selectedDevice;
        return (
          <div style={{ display: (latestPhotoAlert || viewingPhotoAlert || photoReceiving) ? 'none' : undefined }}>
            <AlertMode
              key={activeAlert.id}
              device={alertSourceDevice}
              activeAlert={activeAlert}
              alertDeviceName={alertDeviceInfoRef.current?.name || alertSourceDevice.name}
              alertDeviceSerial={alertDeviceInfoRef.current?.serial || ((alertSourceDevice.metadata as Record<string, unknown>)?.serial_key ? String((alertSourceDevice.metadata as Record<string, unknown>).serial_key) : null)}
              onDismiss={() => {
                alertDeviceInfoRef.current = null;
                dismissAll();
                setShowFallbackAlarmButtons(false);
              }}
              onSendRemoteAlarmOff={async () => {
                await dismissRemoteAlarm();
                setRemoteAlarmDismissed(true);
              }}
            />
          </div>
        );
      })()}

      {/* Photo Alert Overlay */}
      {(latestPhotoAlert || viewingPhotoAlert) && (
        <PhotoAlertOverlay
          alert={(viewingPhotoAlert || latestPhotoAlert)!}
          isHistoryView={!!viewingPhotoAlert && !latestPhotoAlert}
          streamingDeviceId={selectedDeviceId}
          alertDeviceName={(() => {
            const a = (viewingPhotoAlert || latestPhotoAlert)!;
            const dev = devices.find(d => d.id === a.device_id);
            return a.device_name || dev?.name || alertDeviceInfoRef.current?.name || "";
          })()}
          alertDeviceSerial={(() => {
            const a = (viewingPhotoAlert || latestPhotoAlert)!;
            const dev = devices.find(d => d.id === a.device_id);
            const meta = dev?.metadata as Record<string, unknown> | undefined;
            return alertDeviceInfoRef.current?.serial || (meta?.serial_key ? String(meta.serial_key) : null);
          })()}
          onBack={() => {
            dismissViewingPhoto();
            openPanel("photoHistory");
          }}
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
      {panels.help && (
        <HelpPage
          isOpen={panels.help}
          onClose={() => closePanel("help")}
        />
      )}

      {/* Legal Page */}
      {panels.legal && (
        <LegalPage
          isOpen={panels.legal}
          onClose={() => closePanel("legal")}
        />
      )}

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

      {/* License expired overlay */}
      <LicenseExpiredOverlay visible={licenseExpired} />

      {/* Permission Request Popup */}
      <PermissionRequestPopup />
    </div>
  );
};

export default Index;
