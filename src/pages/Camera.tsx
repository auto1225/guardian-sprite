import { useState, useCallback } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";
import CameraHeader from "@/components/camera/CameraHeader";
import CameraViewer from "@/components/camera/CameraViewer";
import CameraControls from "@/components/camera/CameraControls";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface CameraPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const CameraPage = ({ device, isOpen, onClose }: CameraPageProps) => {
  const { toast } = useToast();
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    isConnecting,
    isConnected,
    remoteStream,
    connect,
    disconnect,
  } = useWebRTCViewer({
    deviceId: device.id,
    onError: (err) => {
      setError(err);
      toast({
        title: "연결 오류",
        description: err,
        variant: "destructive",
      });
    },
  });

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

  // 스트리밍 시작
  const startStreaming = useCallback(async () => {
    setIsStreaming(true);
    setError(null);

    // 노트북에게 스트리밍 시작 요청
    await requestStreamingStart();

    // WebRTC 연결 시작
    await connect();
  }, [requestStreamingStart, connect]);

  // 스트리밍 중지
  const stopStreaming = useCallback(async () => {
    setIsStreaming(false);

    // WebRTC 연결 종료
    disconnect();

    // 노트북에게 스트리밍 중지 요청
    await requestStreamingStop();
  }, [disconnect, requestStreamingStop]);

  // 스냅샷 캡처 요청
  const captureSnapshot = useCallback(async () => {
    try {
      toast({ title: "스냅샷 요청 중..." });

      const { error: cmdError } = await supabase.from("commands").insert({
        device_id: device.id,
        command_type: "camera_capture",
        status: "pending",
      });

      if (cmdError) throw cmdError;

      toast({
        title: "스냅샷 요청 완료",
        description: "잠시 후 이미지가 저장됩니다.",
      });
    } catch (err) {
      console.error("Failed to capture snapshot:", err);
      toast({
        title: "오류",
        description: "스냅샷 캡처에 실패했습니다",
        variant: "destructive",
      });
    }
  }, [device.id, toast]);

  // 모달 닫힐 때 정리
  const handleClose = useCallback(() => {
    if (isStreaming) {
      stopStreaming();
    }
    onClose();
  }, [isStreaming, stopStreaming, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-card z-50 flex flex-col">
      <CameraHeader onClose={handleClose} deviceName={device.name} />

      <CameraViewer
        isStreaming={isStreaming}
        isConnecting={isConnecting}
        isConnected={isConnected}
        remoteStream={remoteStream}
        error={error}
        onRetry={startStreaming}
        onCapture={captureSnapshot}
      />

      <CameraControls
        isStreaming={isStreaming}
        onStart={startStreaming}
        onStop={stopStreaming}
      />
    </div>
  );
};

export default CameraPage;
