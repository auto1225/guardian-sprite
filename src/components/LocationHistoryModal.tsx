import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, MapPin, Loader2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { format } from "date-fns";
import { ko, enUS } from "date-fns/locale";

// @ts-expect-error Leaflet bundler icon fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const redIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationRecord {
  id: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  ip_address: string | null;
  recorded_at: string;
}

interface LocationHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string | null;
  deviceName: string;
}

const LocationHistoryModal = ({ isOpen, onClose, deviceId, deviceName }: LocationHistoryModalProps) => {
  const { t, i18n } = useTranslation();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    if (!isOpen || !deviceId) return;
    setLoading(true);
    supabase
      .from("device_locations")
      .select("*")
      .eq("device_id", deviceId)
      .order("recorded_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setLocations((data || []) as LocationRecord[]);
        setLoading(false);
        setSelectedIdx(null);
      });
  }, [isOpen, deviceId]);

  if (!isOpen) return null;

  const validLocations = locations.filter(l => l.latitude !== null && l.longitude !== null);
  const polylinePositions = validLocations.map(l => [l.latitude!, l.longitude!] as [number, number]);
  const center: [number, number] = validLocations.length > 0
    ? [validLocations[0].latitude!, validLocations[0].longitude!]
    : [37.5665, 126.9780]; // Seoul fallback
  const dateFnsLocale = i18n.language === "ko" ? ko : enUS;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[95%] max-w-[450px] max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl border border-white/25 flex flex-col"
        style={{ background: 'linear-gradient(180deg, hsla(200, 70%, 55%, 0.92) 0%, hsla(210, 60%, 40%, 0.95) 100%)', backdropFilter: 'blur(24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Clock className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-base">{t("locationHistory.title")}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-white/80" />
          </button>
        </div>

        <div className="flex justify-center pb-3">
          <div className="rounded-full px-4 py-1 text-xs font-bold bg-secondary text-secondary-foreground">{deviceName}</div>
        </div>

        {/* Map */}
        <div className="h-48 mx-4 rounded-xl overflow-hidden border border-white/20 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/10">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
            </div>
          ) : validLocations.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/10">
              <p className="text-sm text-white/60">{t("locationHistory.noHistory")}</p>
            </div>
          ) : (
            <MapContainer
              center={selectedIdx !== null && validLocations[selectedIdx] ? [validLocations[selectedIdx].latitude!, validLocations[selectedIdx].longitude!] : center}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
              key={selectedIdx}
            >
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {polylinePositions.length > 1 && (
                <Polyline positions={polylinePositions} color="#3b82f6" weight={3} opacity={0.6} dashArray="8 4" />
              )}
              {validLocations.map((loc, idx) => (
                <Marker
                  key={loc.id}
                  position={[loc.latitude!, loc.longitude!]}
                  icon={idx === 0 ? redIcon : L.icon({
                    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
                    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
                    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
                  })}
                >
                  <Popup>
                    <div className="text-xs">
                      <p className="font-bold">{idx === 0 ? t("locationHistory.latest") : `#${idx + 1}`}</p>
                      <p>{format(new Date(loc.recorded_at), "yyyy-MM-dd HH:mm:ss", { locale: dateFnsLocale })}</p>
                      {loc.city && <p>{loc.city}, {loc.country}</p>}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}
        </div>

        {/* Timeline list */}
        <div className="p-4 flex-1 overflow-hidden flex flex-col min-h-0">
          <button
            onClick={() => setShowList(!showList)}
            className="flex items-center justify-between w-full mb-2"
          >
            <span className="text-sm font-bold text-white">
              {t("locationHistory.records", { count: validLocations.length })}
            </span>
            {showList ? <ChevronUp className="w-4 h-4 text-white/60" /> : <ChevronDown className="w-4 h-4 text-white/60" />}
          </button>

          {showList && (
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 alert-history-scroll min-h-0 max-h-[30vh]">
              {validLocations.map((loc, idx) => (
                <button
                  key={loc.id}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                    selectedIdx === idx ? "bg-white/25 border border-white/30" : "bg-white/10 hover:bg-white/15"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className={`w-3.5 h-3.5 shrink-0 ${idx === 0 ? "text-red-300" : "text-white/60"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white/90 font-medium truncate">
                        {loc.city ? `${loc.city}, ${loc.country}` : `${loc.latitude?.toFixed(4)}, ${loc.longitude?.toFixed(4)}`}
                      </p>
                      <p className="text-[10px] text-white/50">
                        {format(new Date(loc.recorded_at), "yyyy-MM-dd HH:mm:ss", { locale: dateFnsLocale })}
                        {loc.ip_address && ` · ${loc.ip_address}`}
                      </p>
                    </div>
                    {idx === 0 && (
                      <span className="text-[10px] bg-red-500/80 text-white px-1.5 py-0.5 rounded-full shrink-0">
                        {t("locationHistory.latest")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationHistoryModal;
