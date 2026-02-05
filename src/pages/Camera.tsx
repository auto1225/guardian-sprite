import { ArrowLeft, Camera, RefreshCw, Download } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface CameraPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const CameraPage = ({ device, isOpen, onClose }: CameraPageProps) => {
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 스트리밍 시작 요청 (노트북에게 카메라 켜라고 명령)
  const requestStreamingStart = useCallback(async () => {
    try {
      console.log("Requesting camera streaming start for device:", device.id);
      const { error: updateError } = await supabase
        .from("devices")
        .update({ is_streaming_requested: true })
        .eq("id", device.id);
      
      if (updateError) throw updateError;
      console.log("Streaming request sent successfully");
    } catch (err) {
      console.error("Failed to request streaming:", err);
    }
  }, [device.id]);

  // 스트리밍 중지 요청
  const requestStreamingStop = useCallback(async () => {
    try {
      console.log("Requesting camera streaming stop for device:", device.id);
      const { error: updateError } = await supabase
        .from("devices")
        .update({ is_streaming_requested: false })
        .eq("id", device.id);
      
      if (updateError) throw updateError;
    } catch (err) {
      console.error("Failed to stop streaming:", err);
    }
  }, [device.id]);

  // 최신 스냅샷 가져오기
  const fetchLatestSnapshot = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from("camera_captures")
        .select("image_url, captured_at")
        .eq("device_id", device.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .single();

      if (fetchError) {
        if (fetchError.code === "PGRST116") {
          return; // No data found
        }
        throw fetchError;
      }
      
      if (data?.image_url) {
        setImageUrl(data.image_url + "?t=" + Date.now());
        setError(null);
      }
    } catch (err) {
      console.error("Failed to fetch snapshot:", err);
    }
  }, [device.id]);

  // 스냅샷 캡처 요청
  const captureSnapshot = useCallback(async () => {
    try {
      toast({ title: "스냅샷 요청 중..." });
      
      const { error: cmdError } = await supabase
        .from("commands")
        .insert({
          device_id: device.id,
          command_type: "camera_capture",
          status: "pending",
        });
      
      if (cmdError) throw cmdError;
      
      toast({ title: "스냅샷 요청 완료", description: "잠시 후 이미지가 업데이트됩니다." });
    } catch (err) {
      console.error("Failed to capture snapshot:", err);
      toast({
        title: "오류",
        description: "스냅샷 캡처에 실패했습니다",
        variant: "destructive",
      });
    }
  }, [device.id, toast]);

  // 스트리밍 시작
  const startStreaming = useCallback(async () => {
    setIsStreaming(true);
    setIsLoading(true);
    setError(null);
    
    // 노트북에게 스트리밍 시작 요청
    await requestStreamingStart();
    
    // 즉시 첫 스냅샷 가져오기 시도
    await fetchLatestSnapshot();
    setIsLoading(false);
    
    // 1초마다 새 스냅샷 가져오기
    intervalRef.current = setInterval(() => {
      fetchLatestSnapshot();
    }, 1000);
  }, [requestStreamingStart, fetchLatestSnapshot]);

  // 스트리밍 중지
  const stopStreaming = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsStreaming(false);
    
    // 노트북에게 스트리밍 중지 요청
    await requestStreamingStop();
  }, [requestStreamingStop]);

  // 실시간 구독 (새 스냅샷 업로드 시)
  useEffect(() => {
    if (!isOpen || !device.id) return;

    const channel = supabase
      .channel(`camera-${device.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "camera_captures",
          filter: `device_id=eq.${device.id}`,
        },
        (payload) => {
          console.log("Received new camera capture");
          const newCapture = payload.new as { image_url: string };
          if (newCapture.image_url) {
            setImageUrl(newCapture.image_url + "?t=" + Date.now());
            setError(null);
            setIsLoading(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, device.id]);

  // 모달 닫힐 때 정리
  useEffect(() => {
    if (!isOpen) {
      if (isStreaming) {
        stopStreaming();
      }
      setImageUrl(null);
      setError(null);
    }
  }, [isOpen, isStreaming, stopStreaming]);

  const handleDownload = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
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
        <div className="w-6" />
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
            노트북 카메라를 실시간으로 확인할 수 있습니다.
          </p>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {!isStreaming ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <Camera className="w-12 h-12 opacity-50" />
            <div>
              <p>노트북 카메라를 보려면</p>
              <p className="text-sm mt-1">아래 버튼을 눌러주세요</p>
            </div>
          </div>
        ) : isLoading && !imageUrl ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p>카메라 연결 중...</p>
            <p className="text-xs">노트북에서 카메라가 시작될 때까지 대기 중</p>
          </div>
        ) : error ? (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <p>{error}</p>
            <button
              onClick={fetchLatestSnapshot}
              className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              다시 시도
            </button>
          </div>
        ) : imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt="실시간 카메라"
              className="max-w-full max-h-full object-contain"
            />
            {/* LIVE indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-1 bg-black/60 px-2 py-1 rounded">
              <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-white text-xs font-bold">LIVE</span>
            </div>
            {/* Action buttons */}
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button
                onClick={captureSnapshot}
                className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
                title="스냅샷 저장"
              >
                <Camera className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDownload(imageUrl)}
                className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
                title="다운로드"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center text-white/50 flex flex-col items-center gap-4">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <p>노트북에서 카메라 시작 대기 중...</p>
            <p className="text-xs">노트북 앱이 실행 중인지 확인하세요</p>
          </div>
        )}
      </div>

      {/* Stream control button */}
      <div className="p-4 bg-card">
        {!isStreaming ? (
          <button
            onClick={startStreaming}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" />
            카메라 보기
          </button>
        ) : (
          <button
            onClick={stopStreaming}
            className="w-full py-3 bg-destructive text-destructive-foreground rounded-lg font-medium flex items-center justify-center gap-2"
          >
            스트리밍 중지
          </button>
        )}
      </div>
    </div>
  );
};

export default CameraPage;
