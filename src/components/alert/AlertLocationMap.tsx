import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2 } from "lucide-react";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { address, loading: addressLoading } = useReverseGeocode(latitude, longitude);
  const isApproximate = locationSource && locationSource !== "gps";

  return (
    <div className="mx-4 mb-3 shrink-0">
      <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <MapPin size={16} className="text-white/80" />
          <span className="text-white font-bold text-sm">{t("alertLocation.title")}</span>
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
              <Popup>{t("alertLocation.alertLocation")}</Popup>
            </Marker>
          </MapContainer>
        </div>
        <div className="px-4 py-2.5 space-y-1.5">
          {/* 주소 */}
          {addressLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <Loader2 size={12} className="animate-spin" />
              <span>{t("alertLocation.loadingAddress")}</span>
            </div>
          ) : address ? (
            <p className="text-xs text-white/80 leading-relaxed">📌 {address}</p>
          ) : null}

          {/* 좌표 */}
          <p className="text-xs text-white/60">
            {t("alertLocation.latitude")}: {latitude.toFixed(6)} | {t("alertLocation.longitude")}: {longitude.toFixed(6)}
            {locationSource && (
              <span className="ml-2 text-white/40">
                ({locationSource === "gps" ? "GPS" : "Wi-Fi/IP"})
              </span>
            )}
          </p>

          {isApproximate && (
            <p className="text-[10px] text-yellow-300/70 leading-relaxed">
              {t("alertLocation.wifiWarning")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
