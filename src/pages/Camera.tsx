import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface CameraPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const CameraPage = ({ device, isOpen, onClose }: CameraPageProps) => {
  const { captureCamera } = useCommands();
  const { toast } = useToast();
  const [isCapturing, setIsCapturing] = useState(false);

  const { data: captures = [], refetch } = useQuery({
    queryKey: ["camera-captures", device.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("camera_captures")
        .select("*")
        .eq("device_id", device.id)
        .order("captured_at", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    enabled: isOpen,
  });

  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      await captureCamera(device.id);
      toast({
        title: "촬영 요청",
        description: "노트북에 촬영 요청을 보냈습니다.",
      });
      // Refetch after a short delay to get the new capture
      setTimeout(() => refetch(), 3000);
    } catch (error) {
      toast({
        title: "오류",
        description: "촬영 요청에 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsCapturing(false);
    }
  };

  const handleDownload = (imageUrl: string) => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `meercop-capture-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

      {/* Camera info banner */}
      <div className="bg-primary px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-status-active rounded-full flex items-center justify-center">
          <span className="text-white text-sm">📷</span>
        </div>
        <div>
          <p className="text-primary-foreground font-bold text-sm">Camera</p>
          <p className="text-primary-foreground/70 text-xs">
            "카메라"는 노트북 카메라의 정상 작동 및 스냅사진 촬영 가능 여부를 나타냅니다.
          </p>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {captures.length > 0 ? (
          <img
            src={captures[0].image_url}
            alt="최근 캡처"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-center text-white/50">
            <p>캡처된 이미지가 없습니다</p>
            <p className="text-sm mt-2">아래 버튼을 눌러 촬영하세요</p>
          </div>
        )}

        {/* Download button */}
        {captures.length > 0 && (
          <button
            onClick={() => handleDownload(captures[0].image_url)}
            className="absolute bottom-4 right-4 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
          >
            <Download className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Capture button */}
      <div className="p-4 bg-card">
        <button
          onClick={handleCapture}
          disabled={isCapturing}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isCapturing ? "animate-spin" : ""}`} />
          {isCapturing ? "촬영 중..." : "재 촬영"}
        </button>
      </div>
    </div>
  );
};

export default CameraPage;
