import { useEffect, useState } from "react";
import { X, Wifi, Globe, BarChart3, Loader2, Zap, Clock } from "lucide-react";
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
        { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${deviceId}` },
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[90%] max-w-[400px] rounded-2xl overflow-hidden shadow-2xl border border-white/25"
        style={{
          background: 'linear-gradient(180deg, hsla(200, 70%, 55%, 0.88) 0%, hsla(210, 60%, 40%, 0.92) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Wifi className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-base">네트워크 정보</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-white/80" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 pt-1 space-y-2.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-white/60" />
              <p className="text-sm text-white/60">네트워크 정보를 불러오는 중...</p>
            </div>
          ) : (
            <>
              {/* 연결 상태 */}
              <div className="rounded-xl px-4 py-3.5 bg-white/15 border border-white/20">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 shadow-lg"
                    style={{
                      backgroundColor: isConnected ? "#4ade80" : "#f87171",
                      boxShadow: isConnected ? "0 0 8px rgba(74,222,128,0.5)" : "0 0 8px rgba(248,113,113,0.5)",
                    }}
                  />
                  <div>
                    <p className="text-[11px] text-white/60">연결 상태</p>
                    <p className="font-bold text-sm text-white">
                      {isConnected ? "온라인" : "오프라인"}
                    </p>
                  </div>
                </div>
              </div>

              {/* IP 주소 */}
              <div className="rounded-xl px-4 py-3.5 bg-white/15 border border-white/20">
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 flex-shrink-0 text-white/70" />
                  <div>
                    <p className="text-[11px] text-white/60">IP 주소</p>
                    <p className="font-bold text-sm font-mono text-white">
                      {ipAddress || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* 연결 유형 */}
              <div className="rounded-xl px-4 py-3.5 bg-white/15 border border-white/20">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 flex-shrink-0 text-white/70" />
                  <div>
                    <p className="text-[11px] text-white/60">연결 유형</p>
                    <p className="font-bold text-sm text-white">
                      {connectionTypeLabel(networkInfo?.type)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 속도 & 지연시간 - 가로 2열 */}
              <div className="flex gap-2.5">
                <div className="flex-1 rounded-xl px-4 py-3.5 text-center bg-white/15 border border-white/20">
                  <Zap className="w-4 h-4 text-secondary mx-auto mb-1" />
                  <p className="text-[11px] text-white/60 mb-0.5">속도</p>
                  <p className="font-bold text-lg text-white">
                    {networkInfo?.downlink != null ? `${networkInfo.downlink}` : "—"}
                  </p>
                  {networkInfo?.downlink != null && <p className="text-[10px] text-white/50">Mbps</p>}
                </div>
                <div className="flex-1 rounded-xl px-4 py-3.5 text-center bg-white/15 border border-white/20">
                  <Clock className="w-4 h-4 text-secondary mx-auto mb-1" />
                  <p className="text-[11px] text-white/60 mb-0.5">지연시간</p>
                  <p className="font-bold text-lg text-white">
                    {networkInfo?.rtt != null ? `${networkInfo.rtt}` : "—"}
                  </p>
                  {networkInfo?.rtt != null && <p className="text-[10px] text-white/50">ms</p>}
                </div>
              </div>

              {/* 유효 연결 등급 */}
              <div className="rounded-xl px-4 py-3.5 text-center bg-white/15 border border-white/20">
                <p className="text-[11px] text-white/60 mb-0.5">유효 연결 등급</p>
                <p className="font-bold text-lg text-secondary">
                  {networkInfo?.effective_type?.toUpperCase() || "—"}
                </p>
              </div>

              {/* 요청 중 표시 */}
              {requesting && (
                <div className="flex items-center justify-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white/60" />
                  <span className="text-xs text-white/60">
                    노트북에 최신 정보를 요청 중...
                  </span>
                </div>
              )}

              {/* 안내 문구 */}
              <p className="text-[10px] text-center px-2 pb-1 text-white/40">
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
