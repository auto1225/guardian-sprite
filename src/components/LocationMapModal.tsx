import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, MapPin, Navigation, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";

// @ts-expect-error Leaflet bundler icon fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LocationMapModalProps { isOpen: boolean; onClose: () => void; deviceId: string | null; deviceName: string; }
interface LocationData { latitude: number | null; longitude: number | null; location_updated_at: string | null; location_source?: string | null; }

const LocationMapModal = ({ isOpen, onClose, deviceId, deviceName }: LocationMapModalProps) => {
  const { t } = useTranslation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandSent, setCommandSent] = useState(false);
  const { address, loading: addressLoading } = useReverseGeocode(location?.latitude, location?.longitude);

  const formatTimeAgo = (dateStr: string): string => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffMin < 1) return t("location.justNow");
    if (diffMin < 60) return t("location.minutesAgo", { count: diffMin });
    if (diffHour < 24) return t("location.hoursAgo", { count: diffHour });
    return t("location.daysAgo", { count: diffDay });
  };

  useEffect(() => {
    if (!isOpen || !deviceId) return;
    const fetchAndRequest = async () => {
      setLoading(true); setError(null); setCommandSent(false);
      const { data: deviceData } = await supabase.from("devices").select("latitude, longitude, location_updated_at, metadata").eq("id", deviceId).maybeSingle();
      const meta = (deviceData?.metadata as Record<string, unknown>) || {};
      if (deviceData && deviceData.latitude !== null && deviceData.longitude !== null) {
        setLocation({ ...deviceData, location_source: (meta.location_source as string) || null }); setLoading(false);
      }
      if (!deviceData?.latitude) {
        const { data: locData } = await supabase.from("device_locations").select("latitude, longitude, recorded_at").eq("device_id", deviceId).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
        if (locData && locData.latitude !== null && locData.longitude !== null) {
          setLocation({ latitude: locData.latitude, longitude: locData.longitude, location_updated_at: locData.recorded_at }); setLoading(false);
        }
      }
      await safeMetadataUpdate(deviceId, { locate_requested: new Date().toISOString() });
      setCommandSent(true);
      if (!deviceData?.latitude) { setError(t("location.requestSent")); setLoading(false); }
    };
    fetchAndRequest();
    const channel = supabase.channel(`device-location-${deviceId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${deviceId}` }, (payload) => {
      const newData = payload.new as { latitude: number | null; longitude: number | null; location_updated_at: string | null; metadata: Record<string, unknown> | null };
      if (newData.latitude !== null && newData.longitude !== null) {
        const newMeta = newData.metadata || {};
        setLocation({ latitude: newData.latitude, longitude: newData.longitude, location_updated_at: newData.location_updated_at, location_source: (newMeta.location_source as string) || null });
        setError(null); setLoading(false);
      }
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOpen, deviceId]);

  if (!isOpen) return null;
  const hasLocation = location && location.latitude !== null && location.longitude !== null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[90%] max-w-[400px] rounded-2xl overflow-hidden shadow-2xl border border-white/25"
        style={{ background: 'linear-gradient(180deg, hsla(200, 70%, 55%, 0.88) 0%, hsla(210, 60%, 40%, 0.92) 100%)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"><MapPin className="w-4 h-4 text-white" /></div>
            <span className="text-white font-bold text-base">{t("location.title")}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"><X className="w-4 h-4 text-white/80" /></button>
        </div>
        <div className="flex justify-center pb-3">
          <div className="rounded-full px-4 py-1 text-xs font-bold bg-secondary text-secondary-foreground">{deviceName}</div>
        </div>
        <div className="h-56 mx-4 rounded-xl overflow-hidden border border-white/20 relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/10">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin mb-2" />
              <span className="text-sm text-white/60">{t("location.loadingLocation")}</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/10">
              <div className="text-center px-4">
                <Navigation className="w-10 h-10 mx-auto mb-2 text-white/40" />
                <p className="text-sm text-white/70">{error}</p>
              </div>
            </div>
          ) : hasLocation ? (
            <MapContainer center={[location.latitude!, location.longitude!]} zoom={16} style={{ height: "100%", width: "100%" }} zoomControl={false}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[location.latitude!, location.longitude!]}>
                <Popup>{t("location.currentLocation")}</Popup>
              </Marker>
            </MapContainer>
          ) : null}
        </div>
        <div className="p-4 space-y-2">
          {hasLocation && (
            <div className="rounded-xl bg-white/15 border border-white/20 px-4 py-3 space-y-1.5">
              {addressLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-white/50"><Loader2 size={12} className="animate-spin" /><span>{t("location.loadingAddress")}</span></div>
              ) : address ? (
                <p className="text-xs text-white/90 leading-relaxed">📌 {address}</p>
              ) : null}
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <span>{t("location.latitude")}: {location.latitude!.toFixed(6)}</span>
                <span className="text-white/40">|</span>
                <span>{t("location.longitude")}: {location.longitude!.toFixed(6)}</span>
                {location.location_source && (
                  <span className="text-xs text-white/40">({location.location_source === "gps" ? t("location.gps") : t("location.wifiIp")})</span>
                )}
              </div>
              {location.location_updated_at && (
                <p className="text-xs text-white/60">{t("location.lastUpdate")}: {formatTimeAgo(location.location_updated_at)}</p>
              )}
            </div>
          )}
          {hasLocation && location.location_source !== "gps" && (
            <p className="text-[10px] text-white/50 text-center px-2">{t("location.wifiWarning")}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationMapModal;