import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface AlertLocationMapProps {
  latitude: number;
  longitude: number;
}

export default function AlertLocationMap({ latitude, longitude }: AlertLocationMapProps) {
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
        <div className="px-4 py-2 text-xs text-white/60">
          위도: {latitude.toFixed(6)} | 경도: {longitude.toFixed(6)}
        </div>
      </div>
    </div>
  );
}
