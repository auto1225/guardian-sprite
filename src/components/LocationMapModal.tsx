import { useEffect, useState } from "react";
import { X, MapPin, Navigation, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";

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
  location_source?: string | null;
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
  const { address, loading: addressLoading } = useReverseGeocode(location?.latitude, location?.longitude);

  useEffect(() => {
    if (!isOpen || !deviceId) return;

    const fetchAndRequest = async () => {
      setLoading(true);
      setError(null);
      setCommandSent(false);

      const { data: deviceData } = await supabase
        .from("devices")
        .select("latitude, longitude, location_updated_at, metadata")
        .eq("id", deviceId)
        .maybeSingle();

      const meta = (deviceData?.metadata as Record<string, unknown>) || {};

      if (deviceData && deviceData.latitude !== null && deviceData.longitude !== null) {
        setLocation({
          ...deviceData,
          location_source: (meta.location_source as string) || null,
        });
        setLoading(false);
      }

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

      const { data: devMeta } = await supabase
        .from("devices")
        .select("metadata")
        .eq("id", deviceId)
        .maybeSingle();
      const existingMeta = (devMeta?.metadata as Record<string, unknown>) || {};
      await supabase
        .from("devices")
        .update({ metadata: { ...existingMeta, locate_requested: new Date().toISOString() } })
        .eq("id", deviceId);

      setCommandSent(true);

      if (!deviceData?.latitude) {
        setError("노트북에 위치 요청을 보냈습니다. 잠시 기다려주세요...");
        setLoading(false);
      }
    };

    fetchAndRequest();

    const channel = supabase
      .channel(`device-location-${deviceId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${deviceId}` },
        (payload) => {
          const newData = payload.new as any;
          if (newData.latitude !== null && newData.longitude !== null) {
            const newMeta = (newData.metadata as Record<string, unknown>) || {};
            setLocation({
              latitude: newData.latitude,
              longitude: newData.longitude,
              location_updated_at: newData.location_updated_at,
              location_source: (newMeta.location_source as string) || null,
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
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-base">노트북 위치</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-white/80" />
          </button>
        </div>

        {/* Device name badge */}
        <div className="flex justify-center pb-3">
          <div className="rounded-full px-4 py-1 text-xs font-bold bg-secondary text-secondary-foreground">
            {deviceName}
          </div>
        </div>

        {/* Map area */}
        <div className="h-56 mx-4 rounded-xl overflow-hidden border border-white/20 relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/10">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin mb-2" />
              <span className="text-sm text-white/60">위치 불러오는 중...</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/10">
              <div className="text-center px-4">
                <Navigation className="w-10 h-10 mx-auto mb-2 text-white/40" />
                <p className="text-sm text-white/70">{error}</p>
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
            <div className="rounded-xl bg-white/15 border border-white/20 px-4 py-3 space-y-1.5">
              {/* 주소 */}
              {addressLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Loader2 size={12} className="animate-spin" />
                  <span>주소 조회 중...</span>
                </div>
              ) : address ? (
                <p className="text-xs text-white/90 leading-relaxed">📌 {address}</p>
              ) : null}

              {/* 좌표 */}
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <span>위도: {location.latitude!.toFixed(6)}</span>
                <span className="text-white/40">|</span>
                <span>경도: {location.longitude!.toFixed(6)}</span>
                {location.location_source && (
                  <span className="text-xs text-white/40">
                    ({location.location_source === "gps" ? "GPS" : "Wi-Fi/IP"})
                  </span>
                )}
              </div>
              {location.location_updated_at && (
                <p className="text-xs text-white/60">
                  마지막 업데이트: {formatTimeAgo(location.location_updated_at)}
                </p>
              )}
            </div>
          )}

          {/* 오차 경고: GPS가 아닌 경우에만 */}
          {hasLocation && location.location_source !== "gps" && (
            <p className="text-[10px] text-white/50 text-center px-2">
              ⚠️ Wi-Fi/IP 기반 위치로, 실제 위치와 수십 m ~ 수 km 오차가 있을 수 있습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationMapModal;
