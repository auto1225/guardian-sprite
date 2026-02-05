import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface LocationPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const LocationPage = ({ device, isOpen, onClose }: LocationPageProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: location, refetch } = useQuery({
    queryKey: ["device-location", device.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_locations")
        .select("*")
        .eq("device_id", device.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: isOpen,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-card z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-card-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-bold text-lg italic">Meer</span>
          <span className="font-black text-lg -mt-1">COP</span>
        </div>
        <div className="w-6" /> {/* Spacer */}
      </div>

      {/* Device name */}
      <div className="flex justify-center py-3">
        <div className="bg-secondary/90 rounded-full px-4 py-1.5">
          <span className="text-secondary-foreground font-bold text-sm">
            {device.name}
          </span>
        </div>
      </div>

      {/* Map placeholder */}
      <div className="flex-1 bg-muted relative">
        {location?.latitude && location?.longitude ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-green-200 to-green-400">
            {/* This would be a real map component in production */}
            <div className="text-center">
              <div className="w-12 h-12 bg-destructive rounded-full flex items-center justify-center mx-auto mb-2 shadow-lg">
                <span className="text-white text-2xl">📍</span>
              </div>
              <p className="text-sm font-medium">지도 영역</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground">위치 정보가 없습니다</p>
          </div>
        )}
      </div>

      {/* Location info */}
      <div className="bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">노트북 위치</h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-status-active">✓</span>
            <span>확인됨</span>
            {location?.recorded_at && (
              <span>
                {format(new Date(location.recorded_at), "yyyy.MM.dd a hh:mm:ss", { locale: ko })}
              </span>
            )}
          </div>
        </div>

        {location ? (
          <>
            <p className="text-card-foreground">
              {location.city || "알 수 없는 위치"}, {location.country || ""}
            </p>
            <p className="text-sm text-muted-foreground">
              위도: {location.latitude?.toFixed(7)} / 경도: {location.longitude?.toFixed(7)}
            </p>
            {location.ip_address && (
              <p className="text-sm text-muted-foreground">
                📶 {location.ip_address}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">위치 정보를 불러오는 중...</p>
        )}

        <p className="text-xs text-destructive">
          ※ 접속된 네트워크에 따라, 위치가 부정확 할 수 있습니다.
        </p>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="w-full py-3 bg-primary/20 text-primary rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          위치 다시 불러오기
        </button>
      </div>
    </div>
  );
};

export default LocationPage;
