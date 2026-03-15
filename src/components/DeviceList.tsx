import { useMemo } from "react";
import { ChevronDown, ChevronUp, X, Monitor } from "lucide-react";
import { useDevices } from "@/hooks/useDevices";
import { useTranslation } from "react-i18next";
import DeviceCard from "./DeviceCard";
import { sortDevicesByOrder } from "@/lib/deviceSortOrder";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface DeviceListProps {
  isExpanded: boolean;
  onToggle: () => void;
  selectedDeviceId: string | null;
  selectedDevice: Device | null;
  onSelectDevice: (id: string) => void;
}

const DeviceList = ({ isExpanded, onToggle, selectedDeviceId, selectedDevice, onSelectDevice }: DeviceListProps) => {
  const { t } = useTranslation();
  const { devices: allDevices, getDeviceCharging } = useDevices();
  // ★ 컨트롤러(시리얼 키 없는 스마트폰)만 제외, 관리 대상 스마트폰은 포함
  const devices = useMemo(
    () => sortDevicesByOrder(allDevices.filter(d => {
      if (d.device_type !== "smartphone") return true;
      return !!(d.metadata as Record<string, unknown>)?.serial_key;
    })),
    [allDevices]
  );

  // 컨트롤러(시리얼 키 없는 스마트폰)만 대기 화면 표시
  const isController = selectedDevice?.device_type === "smartphone" && !(selectedDevice?.metadata as Record<string, unknown>)?.serial_key;
  if (!selectedDevice || isController) {
    return (
      <div className="px-4 py-2">
        <div className="flex items-center justify-center">
          <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-full px-4 py-1.5 shadow-lg">
            <span className="text-white/60 font-medium text-sm">
              {t("deviceList.waitingForDevice")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop overlay — 바깥 탭으로 닫기 */}
      {isExpanded && (
        <div className="fixed inset-0 z-[5]" onClick={onToggle} />
      )}
      <div className="px-4 py-2 relative z-[6]">
        {/* Main device display */}
        <div
          onClick={onToggle}
          className="flex items-center justify-center gap-2 cursor-pointer"
        >
          <div
            className="backdrop-blur-xl border rounded-full px-4 py-1.5 flex items-center gap-2 shadow-lg transition-all"
            style={(() => {
              // ★ 기기가 오프라인이면 is_monitoring이 true여도 OFF 스타일 적용
              const effectiveMonitoring = selectedDevice.is_monitoring && selectedDevice.status !== "offline";
              return {
                background: effectiveMonitoring
                  ? 'linear-gradient(135deg, hsla(80, 70%, 45%, 0.35) 0%, hsla(55, 80%, 50%, 0.25) 100%)'
                  : 'hsla(0, 0%, 100%, 0.15)',
                borderColor: effectiveMonitoring
                  ? 'hsla(80, 60%, 50%, 0.5)'
                  : 'hsla(0, 0%, 100%, 0.25)',
                boxShadow: effectiveMonitoring
                  ? '0 4px 20px hsla(80, 60%, 40%, 0.3), inset 0 1px 0 hsla(0, 0%, 100%, 0.15)'
                  : 'inset 0 1px 0 hsla(0, 0%, 100%, 0.1)',
              };
            })()}
          >
            <span
              className="font-bold text-sm drop-shadow-sm"
              style={{
                color: (selectedDevice.is_monitoring && selectedDevice.status !== "offline") ? 'hsl(55, 80%, 60%)' : 'white',
              }}
            >
              {selectedDevice.name}
            </span>
            {selectedDevice.is_monitoring && selectedDevice.status !== "offline" && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                style={{
                  background: 'hsla(80, 60%, 50%, 0.3)',
                  color: 'hsl(55, 80%, 60%)',
                }}
              >
                ON
              </span>
            )}
            {devices.length > 1 && (
              isExpanded ? (
               <ChevronUp className="w-4 h-4 text-white/80" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/80" />
              )
            )}
          </div>
          {selectedDevice.status !== "offline" && !!(selectedDevice.metadata as Record<string, unknown>)?.camouflage_mode && (
            <div
              className="backdrop-blur-xl border rounded-full px-2.5 py-1.5 flex items-center gap-1.5 shadow-lg"
              style={{
                background: 'linear-gradient(135deg, hsla(220, 30%, 20%, 0.6) 0%, hsla(220, 25%, 15%, 0.5) 100%)',
                borderColor: 'hsla(220, 40%, 50%, 0.5)',
              }}
            >
              <Monitor className="w-3.5 h-3.5" style={{ color: 'hsl(210, 60%, 70%)' }} />
              <span className="text-xs font-bold" style={{ color: 'hsl(210, 60%, 70%)' }}>
                STEALTH
              </span>
            </div>
          )}
        </div>

        {/* Expanded device list */}
        {isExpanded && devices.length > 1 && (
          <div className="absolute left-4 right-4 top-[calc(100%+0.75rem)] z-20 animate-in slide-in-from-top-2 duration-200 overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-3 shadow-lg backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-white/70 text-xs font-medium">{t("deviceList.selectDevice")}</span>
              <button onClick={onToggle} className="text-white/60 transition-colors hover:text-white/90">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              className="webview-scroll-fix alert-history-scroll space-y-2.5 overflow-y-auto"
              style={{ maxHeight: "calc(100svh - 12rem)" }}
            >
              {devices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  isSelected={device.id === selectedDeviceId}
                  isMain={!!((device.metadata as Record<string, unknown>)?.is_main)}
                  isCharging={getDeviceCharging(device.id)}
                  onSelect={() => {
                    onSelectDevice(device.id);
                    onToggle();
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default DeviceList;
