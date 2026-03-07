import { useMemo } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
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
          <div className="bg-white/15 backdrop-blur-xl border border-white/25 rounded-full px-4 py-1.5 flex items-center gap-2 shadow-lg">
            <span className="text-white font-bold text-sm drop-shadow-sm">
              {selectedDevice.name}
            </span>
            {devices.length > 1 && (
              isExpanded ? (
               <ChevronUp className="w-4 h-4 text-white/80" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/80" />
              )
            )}
          </div>
        </div>

        {/* Expanded device list */}
        {isExpanded && devices.length > 1 && (
          <div className="mt-3 animate-in slide-in-from-top-2 duration-200 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-white/70 text-xs font-medium">{t("deviceList.selectDevice")}</span>
              <button onClick={onToggle} className="text-white/60 hover:text-white/90 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-2.5 alert-history-scroll">
              {devices.map((device, index) => (
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
