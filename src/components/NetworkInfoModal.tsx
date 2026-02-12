import { useEffect, useState } from "react";
import { X, Wifi, WifiOff, Loader2 } from "lucide-react";
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

const formatTimeAgo = (dateStr: string): string => {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${diffDay}일 전`;
};

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

      // 기존 데이터 조회
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

      // 노트북에 네트워크 정보 요청
      // 기존 metadata를 보존하면서 network_info_requested만 추가
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

      // 10초 후 요청 상태 해제
      const timeout = setTimeout(() => setRequesting(false), 10000);

      return () => clearTimeout(timeout);
    };

    fetchAndRequest();

    // Realtime 구독
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
        style={{ backgroundColor: "#ffffff" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: "#2D3A5C" }}
        >
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-white" />
            <span className="text-white font-bold text-base">네트워크 정보</span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Device name badge */}
        <div className="flex justify-center py-2" style={{ backgroundColor: "#2D3A5C" }}>
          <div
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{ backgroundColor: "#E8F84A", color: "#2D3A5C" }}
          >
            {deviceName}
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4" style={{ backgroundColor: "#ffffff" }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#2D3A5C" }} />
              <p className="text-sm" style={{ color: "#6b7280" }}>
                네트워크 정보를 불러오는 중...
              </p>
            </div>
          ) : (
            <>
              {/* Connection status */}
              <div className="flex items-center justify-between py-3 px-4 rounded-xl" style={{ backgroundColor: "#f3f4f6" }}>
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <Wifi className="w-6 h-6" style={{ color: "#22c55e" }} />
                  ) : (
                    <WifiOff className="w-6 h-6" style={{ color: "#ef4444" }} />
                  )}
                  <span className="font-semibold text-sm" style={{ color: "#1f2937" }}>
                    연결 상태
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: isConnected ? "#22c55e" : "#ef4444" }}
                  />
                  <span className="text-sm font-medium" style={{ color: isConnected ? "#22c55e" : "#ef4444" }}>
                    {isConnected ? "온라인" : "오프라인"}
                  </span>
                </div>
              </div>

              {/* Network details */}
              <div className="space-y-3">
                <InfoRow label="IP 주소" value={ipAddress || "—"} />
                <InfoRow label="연결 유형" value={connectionTypeLabel(networkInfo?.type)} />
                <InfoRow
                  label="속도"
                  value={networkInfo?.downlink != null ? `${networkInfo.downlink} Mbps` : "—"}
                />
                <InfoRow
                  label="지연시간"
                  value={networkInfo?.rtt != null ? `${networkInfo.rtt} ms` : "—"}
                />
                <InfoRow
                  label="유효 연결 등급"
                  value={networkInfo?.effective_type?.toUpperCase() || "—"}
                />
              </div>

              {/* Requesting indicator */}
              {requesting && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#2D3A5C" }} />
                  <span className="text-xs" style={{ color: "#6b7280" }}>
                    노트북에 최신 정보를 요청 중...
                  </span>
                </div>
              )}

              {/* Update time */}
              {networkInfo?.updated_at && (
                <p className="text-xs text-center" style={{ color: "#6b7280" }}>
                  마지막 업데이트: {formatTimeAgo(networkInfo.updated_at)}
                </p>
              )}

              {/* Disclaimer */}
              <p className="text-[10px] text-center" style={{ color: "rgba(107, 114, 128, 0.7)" }}>
                📡 브라우저 Network Information API 기반으로, 실제 속도와 차이가 있을 수 있습니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between py-2 px-4 rounded-lg" style={{ backgroundColor: "#f9fafb" }}>
    <span className="text-sm" style={{ color: "#6b7280" }}>{label}</span>
    <span className="text-sm font-semibold" style={{ color: "#1f2937" }}>{value}</span>
  </div>
);

export default NetworkInfoModal;
