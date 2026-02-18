import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2 } from "lucide-react";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";

// Fix default marker icon
// @ts-expect-error Leaflet bundler icon fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface AlertLocationMapProps {
  latitude: number;
  longitude: number;
  locationSource?: "gps" | "wifi" | string | null;
}

export default function AlertLocationMap({ latitude, longitude, locationSource }: AlertLocationMapProps) {
  const { address, loading: addressLoading } = useReverseGeocode(latitude, longitude);
  const isApproximate = locationSource && locationSource !== "gps";

  return (
    <div className="mx-4 mb-3 shrink-0">
      <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <MapPin size={16} className="text-white/80" />
          <span className="text-white font-bold text-sm">📍 노트북 위치</span>
        </div>
        <div className="h-48 relative">
          <MapContainer
            center={[latitude, longitude]}
            zoom={16}
            style={{ height: "100%", width: "100%" }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[latitude, longitude]}>
              <Popup>📍 경보 발생 시 노트북 위치</Popup>
            </Marker>
          </MapContainer>
        </div>
        <div className="px-4 py-2.5 space-y-1.5">
          {/* 주소 */}
          {addressLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <Loader2 size={12} className="animate-spin" />
              <span>주소 조회 중...</span>
            </div>
          ) : address ? (
            <p className="text-xs text-white/80 leading-relaxed">📌 {address}</p>
          ) : null}

          {/* 좌표 */}
          <p className="text-xs text-white/60">
            위도: {latitude.toFixed(6)} | 경도: {longitude.toFixed(6)}
            {locationSource && (
              <span className="ml-2 text-white/40">
                ({locationSource === "gps" ? "GPS" : "Wi-Fi/IP"})
              </span>
            )}
          </p>

          {/* Wi-Fi/IP 오차 경고 */}
          {isApproximate && (
            <p className="text-[10px] text-yellow-300/70 leading-relaxed">
              ⚠️ Wi-Fi/IP 기반 위치로, 실제 위치와 수십 m ~ 수 km 오차가 있을 수 있습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
