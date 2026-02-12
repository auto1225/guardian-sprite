import { useEffect, useState } from "react";
import { X, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LocationMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string | null;
  deviceName: string;
}

interface LocationData {
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
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

const LocationMapModal = ({ isOpen, onClose, deviceId, deviceName }: LocationMapModalProps) => {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandSent, setCommandSent] = useState(false);

  useEffect(() => {
    if (!isOpen || !deviceId) return;

    const fetchAndRequest = async () => {
      setLoading(true);
      setError(null);
      setCommandSent(false);

      // 1차: devices 테이블에서 위치 조회
      const { data: deviceData } = await supabase
        .from("devices")
        .select("latitude, longitude, location_updated_at")
        .eq("id", deviceId)
        .maybeSingle();

      if (deviceData && deviceData.latitude !== null && deviceData.longitude !== null) {
        setLocation(deviceData);
        setLoading(false);
      }

      // 2차 fallback: device_locations 테이블
      if (!deviceData?.latitude) {
        const { data: locData } = await supabase
          .from("device_locations")
          .select("latitude, longitude, recorded_at")
          .eq("device_id", deviceId)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (locData && locData.latitude !== null && locData.longitude !== null) {
          setLocation({
            latitude: locData.latitude,
            longitude: locData.longitude,
            location_updated_at: locData.recorded_at,
          });
          setLoading(false);
        }
      }

      // 노트북에 locate 명령 전송 (최신 위치 요청)
      const { error: cmdError } = await supabase
        .from("commands")
        .insert({
          device_id: deviceId,
          command_type: "locate" as const,
          status: "pending" as const,
        });

      if (!cmdError) {
        setCommandSent(true);
      }

      // 기존 위치가 없으면 "요청 중" 표시
      if (!deviceData?.latitude) {
        setError("노트북에 위치 요청을 보냈습니다. 잠시 기다려주세요...");
        setLoading(false);
      }
    };

    fetchAndRequest();

    // Realtime: 노트북이 위치를 저장하면 즉시 반영
    const channel = supabase
      .channel(`device-location-${deviceId}`)
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
          if (newData.latitude !== null && newData.longitude !== null) {
            setLocation({
              latitude: newData.latitude,
              longitude: newData.longitude,
              location_updated_at: newData.location_updated_at,
            });
            setError(null);
            setLoading(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, deviceId]);

  if (!isOpen) return null;

  const hasLocation = location && location.latitude !== null && location.longitude !== null;

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
            <MapPin className="w-5 h-5 text-white" />
            <span className="text-white font-bold text-base">노트북 위치</span>
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

        {/* Map area */}
        <div className="h-64 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "#e5e7eb" }}>
              <span className="text-sm" style={{ color: "#6b7280" }}>위치 불러오는 중...</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "#e5e7eb" }}>
              <div className="text-center px-4">
                <MapPin className="w-10 h-10 mx-auto mb-2" style={{ color: "#9ca3af" }} />
                <p className="text-sm" style={{ color: "#6b7280" }}>{error}</p>
              </div>
            </div>
          ) : hasLocation ? (
            <MapContainer
              center={[location.latitude!, location.longitude!]}
              zoom={16}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={[location.latitude!, location.longitude!]}>
                <Popup>📍 현재 노트북 위치</Popup>
              </Marker>
            </MapContainer>
          ) : null}
        </div>

        {/* Info area - fixed light background with dark text */}
        <div className="p-4 space-y-2" style={{ backgroundColor: "#ffffff" }}>
          {hasLocation && (
            <>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#1f2937" }}>
                <span>위도: {location.latitude!.toFixed(6)}</span>
                <span style={{ color: "#9ca3af" }}>|</span>
                <span>경도: {location.longitude!.toFixed(6)}</span>
              </div>

              {location.location_updated_at && (
                <p className="text-xs" style={{ color: "#6b7280" }}>
                  마지막 업데이트: {formatTimeAgo(location.location_updated_at)}
                </p>
              )}
            </>
          )}

          <p className="text-[10px]" style={{ color: "rgba(107, 114, 128, 0.7)" }}>
            📡 Wi-Fi/IP 기반 위치로, 실제 위치와 20m~수 km 오차가 있을 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LocationMapModal;
