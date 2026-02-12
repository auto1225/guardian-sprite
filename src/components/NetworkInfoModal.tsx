import { useEffect, useState } from "react";
import { X, Wifi, WifiOff, Globe, BarChart3, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface NetworkInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string | null;
  deviceName: string;
}

interface NetworkInfo {
  type?: string;
  downlink?: number;
  rtt?: number;
  effective_type?: string;
  updated_at?: string;
}

const NetworkInfoModal = ({ isOpen, onClose, deviceId, deviceName }: NetworkInfoModalProps) => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!isOpen || !deviceId) return;

    const fetchAndRequest = async () => {
      setLoading(true);
      setRequesting(true);

      const { data } = await supabase
        .from("devices")
        .select("ip_address, is_network_connected, metadata")
        .eq("id", deviceId)
        .maybeSingle();

      if (data) {
        setIsConnected(data.is_network_connected);
        setIpAddress(data.ip_address);
        const meta = data.metadata as any;
        if (meta?.network_info) {
          setNetworkInfo(meta.network_info);
        }
      }

      setLoading(false);

      const currentMeta = (data?.metadata as any) || {};
      await supabase
        .from("devices")
        .update({
          metadata: {
            ...currentMeta,
            network_info_requested: new Date().toISOString(),
          },
        })
        .eq("id", deviceId);

      const timeout = setTimeout(() => setRequesting(false), 10000);
      return () => clearTimeout(timeout);
    };

    fetchAndRequest();

    const channel = supabase
      .channel(`network-info-${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${deviceId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          const meta = newData.metadata;
          if (meta?.network_info && !meta?.network_info_requested) {
            setNetworkInfo(meta.network_info);
            setIpAddress(newData.ip_address);
            setIsConnected(newData.is_network_connected);
            setRequesting(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, deviceId]);

  if (!isOpen) return null;

  const connectionTypeLabel = (type?: string) => {
    if (!type) return "알 수 없음";
    const map: Record<string, string> = {
      wifi: "Wi-Fi",
      ethernet: "유선 (Ethernet)",
      cellular: "셀룰러",
      bluetooth: "블루투스",
      none: "연결 없음",
      other: "기타",
    };
    return map[type.toLowerCase()] || type;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[90%] max-w-[400px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: "#f0f4f8" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ backgroundColor: "#2D3A5C" }}
        >
          <div className="flex items-center gap-2.5">
            <Wifi className="w-5 h-5 text-white" />
            <span className="text-white font-bold text-base">네트워크 정보</span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#2D3A5C" }} />
              <p className="text-sm" style={{ color: "#6b7280" }}>
                네트워크 정보를 불러오는 중...
              </p>
            </div>
          ) : (
            <>
              {/* 연결 상태 */}
              <div className="rounded-xl px-5 py-4" style={{ backgroundColor: "#ffffff" }}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: isConnected ? "#22c55e" : "#ef4444" }}
                  />
                  <div>
                    <p className="text-xs" style={{ color: "#6b7280" }}>연결 상태</p>
                    <p className="font-bold text-base" style={{ color: "#1f2937" }}>
                      {isConnected ? "온라인" : "오프라인"}
                    </p>
                  </div>
                </div>
              </div>

              {/* IP 주소 */}
              <div className="rounded-xl px-5 py-4" style={{ backgroundColor: "#ffffff" }}>
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 flex-shrink-0" style={{ color: "#2D3A5C" }} />
                  <div>
                    <p className="text-xs" style={{ color: "#6b7280" }}>IP 주소</p>
                    <p className="font-bold text-base font-mono" style={{ color: "#1f2937" }}>
                      {ipAddress || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 연결 유형 */}
              <div className="rounded-xl px-5 py-4" style={{ backgroundColor: "#ffffff" }}>
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 flex-shrink-0" style={{ color: "#2D3A5C" }} />
                  <div>
                    <p className="text-xs" style={{ color: "#6b7280" }}>연결 유형</p>
                    <p className="font-bold text-base" style={{ color: "#1f2937" }}>
                      {connectionTypeLabel(networkInfo?.type)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 속도 & 지연시간 - 가로 2열 */}
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl px-4 py-4 text-center" style={{ backgroundColor: "#ffffff" }}>
                  <p className="text-xs mb-1" style={{ color: "#6b7280" }}>속도</p>
                  <p className="font-bold text-lg" style={{ color: "#1f2937" }}>
                    {networkInfo?.downlink != null ? `${networkInfo.downlink} Mbps` : "—"}
                  </p>
                </div>
                <div className="flex-1 rounded-xl px-4 py-4 text-center" style={{ backgroundColor: "#ffffff" }}>
                  <p className="text-xs mb-1" style={{ color: "#6b7280" }}>지연시간 (RTT)</p>
                  <p className="font-bold text-lg" style={{ color: "#1f2937" }}>
                    {networkInfo?.rtt != null ? `${networkInfo.rtt} ms` : "—"}
                  </p>
                </div>
              </div>

              {/* 유효 연결 등급 */}
              <div className="rounded-xl px-5 py-4 text-center" style={{ backgroundColor: "#ffffff" }}>
                <p className="text-xs mb-1" style={{ color: "#6b7280" }}>유효 연결 등급</p>
                <p className="font-bold text-lg" style={{ color: "#1f2937" }}>
                  {networkInfo?.effective_type?.toUpperCase() || "—"}
                </p>
              </div>

              {/* 요청 중 표시 */}
              {requesting && (
                <div className="flex items-center justify-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#2D3A5C" }} />
                  <span className="text-xs" style={{ color: "#6b7280" }}>
                    노트북에 최신 정보를 요청 중...
                  </span>
                </div>
              )}

              {/* 안내 문구 */}
              <p className="text-[11px] text-center px-2 pb-1" style={{ color: "rgba(107, 114, 128, 0.7)" }}>
                📡 브라우저 Network Information API 기반으로, 실제 속도와 차이가 있을 수 있습니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NetworkInfoModal;
