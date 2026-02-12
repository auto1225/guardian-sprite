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

  useEffect(() => {
    if (!isOpen || !deviceId) return;

    const fetchLocation = async () => {
      setLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from("devices")
        .select("latitude, longitude, location_updated_at")
        .eq("id", deviceId)
        .maybeSingle();

      if (queryError) {
        setError("위치 정보를 불러오는데 실패했습니다.");
        setLoading(false);
        return;
      }

      if (!data || data.latitude === null || data.longitude === null) {
        setError("노트북 위치 정보가 없습니다.");
        setLoading(false);
        return;
      }

      setLocation(data);
      setLoading(false);
    };

    fetchLocation();

    // Realtime subscription for location updates
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
        className="w-[90%] max-w-[400px] rounded-2xl overflow-hidden shadow-2xl bg-card"
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
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <span className="text-muted-foreground text-sm">위치 불러오는 중...</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-center px-4">
                <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">{error}</p>
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

        {/* Info area */}
        <div className="p-4 space-y-2">
          {hasLocation && (
            <>
              <div className="flex items-center gap-2 text-sm text-card-foreground">
                <span>위도: {location.latitude!.toFixed(6)}</span>
                <span className="text-muted-foreground">|</span>
                <span>경도: {location.longitude!.toFixed(6)}</span>
              </div>

              {location.location_updated_at && (
                <p className="text-xs text-muted-foreground">
                  마지막 업데이트: {formatTimeAgo(location.location_updated_at)}
                </p>
              )}
            </>
          )}

          <p className="text-[10px] text-muted-foreground/70">
            📡 Wi-Fi/IP 기반 위치로, 실제 위치와 20m~수 km 오차가 있을 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LocationMapModal;
