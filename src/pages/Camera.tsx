import { useState, useCallback, useEffect, useRef } from "react";
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
  const [isWaitingForCamera, setIsWaitingForCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isConnectingRef = useRef(false);
  const connectionStartTimeRef = useRef<number>(0); // Track when connection started

  const handleWebRTCError = useCallback((err: string) => {
    // Ignore errors if we're no longer trying to connect
    if (!isConnectingRef.current) {
      console.log("[Camera] Ignoring error, not connecting:", err);
      return;
    }
    setError(err);
    toast({
      title: "연결 오류",
      description: err,
      variant: "destructive",
    });
  }, [toast]);

  const {
    isConnecting,
    isConnected,
    remoteStream,
    connect,
    disconnect,
  } = useWebRTCViewer({
    deviceId: device.id,
    onError: handleWebRTCError,
  });

  // 스트리밍 시작 요청 (노트북에게 카메라 켜라고 명령)
  const requestStreamingStart = useCallback(async () => {
    try {
      console.log("[Camera] Requesting streaming start for device:", device.id);
      const { error: updateError } = await supabase
        .from("devices")
        .update({ is_streaming_requested: true })
        .eq("id", device.id);

      if (updateError) throw updateError;
      console.log("[Camera] Streaming request sent successfully");
    } catch (err) {
      console.error("[Camera] Failed to request streaming:", err);
    }
  }, [device.id]);

  // 스트리밍 중지 요청 - 최소 연결 시간 체크
  const requestStreamingStop = useCallback(async () => {
    const elapsed = Date.now() - connectionStartTimeRef.current;
    console.log("[Camera] requestStreamingStop called, elapsed:", elapsed, "ms, isConnecting:", isConnectingRef.current);
    
    // 연결 시작 후 5초 이내면 중지 요청 무시 (연결이 안정화될 때까지 대기)
    if (elapsed < 5000 && isConnectingRef.current) {
      console.log("[Camera] ⚠️ Ignoring stop request - connection still stabilizing");
      return;
    }
    
    try {
      console.log("[Camera] ✅ Requesting streaming stop for device:", device.id);
      const { error: updateError } = await supabase
        .from("devices")
        .update({ is_streaming_requested: false })
        .eq("id", device.id);

      if (updateError) throw updateError;
    } catch (err) {
      console.error("[Camera] Failed to stop streaming:", err);
    }
  }, [device.id]);

  // Cleanup subscription
  const cleanupSubscription = useCallback(() => {
    if (waitingTimeoutRef.current) {
      clearTimeout(waitingTimeoutRef.current);
      waitingTimeoutRef.current = null;
    }
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }
  }, []);

  // Broadcaster가 준비될 때까지 폴링으로 대기
  const waitForBroadcaster = useCallback(async (): Promise<boolean> => {
    console.log("[Camera] Polling for broadcaster ready state...");
    for (let i = 0; i < 30; i++) { // 최대 15초 대기 (0.5초 * 30)
      if (!isConnectingRef.current) {
        console.log("[Camera] Connection cancelled during wait");
        return false;
      }
      
      const { data } = await supabase
        .from("devices")
        .select("is_camera_connected")
        .eq("id", device.id)
        .single();
      
      if (data?.is_camera_connected) {
        console.log("[Camera] ✅ Broadcaster is ready! (poll attempt:", i + 1, ")");
        return true;
      }
      
      console.log("[Camera] Broadcaster not ready, waiting... (attempt:", i + 1, ")");
      await new Promise(r => setTimeout(r, 500)); // 0.5초 대기
    }
    return false;
  }, [device.id]);

  // 스트리밍 시작 - 카메라 준비 대기 후 연결
  const startStreaming = useCallback(async () => {
    if (isConnectingRef.current) {
      console.log("[Camera] Already connecting, ignoring...");
      return;
    }
    
    console.log("[Camera] Starting streaming flow...");
    isConnectingRef.current = true;
    connectionStartTimeRef.current = Date.now();
    setIsStreaming(true);
    setIsWaitingForCamera(true);
    setError(null);

    // 1. 노트북에게 스트리밍 시작 요청
    await requestStreamingStart();

    // 2. is_camera_connected가 true가 될 때까지 폴링으로 대기
    const isReady = await waitForBroadcaster();
    
    if (!isReady) {
      console.log("[Camera] Broadcaster not ready after 15s");
      isConnectingRef.current = false;
      setIsWaitingForCamera(false);
      setIsStreaming(false);
      setError("노트북 카메라 응답 시간 초과. 노트북 앱이 실행 중인지 확인하세요.");
      return;
    }

    // 3. 추가로 500ms 대기 (broadcaster의 Realtime 구독이 완전히 준비되도록)
    console.log("[Camera] Waiting additional 500ms for broadcaster subscription...");
    await new Promise(r => setTimeout(r, 500));

    // 4. 이제 viewer-join 전송
    console.log("[Camera] ✅ Starting WebRTC connection...");
    setIsWaitingForCamera(false);
    connect();

    // 30초 WebRTC 연결 타임아웃
    waitingTimeoutRef.current = setTimeout(() => {
      if (isConnectingRef.current && !isConnected) {
        console.log("[Camera] WebRTC connection timeout");
        isConnectingRef.current = false;
        cleanupSubscription();
        setIsStreaming(false);
        setError("WebRTC 연결 시간 초과. 다시 시도해주세요.");
      }
    }, 30000);
  }, [device.id, requestStreamingStart, waitForBroadcaster, connect, cleanupSubscription, isConnected]);

  // 스트리밍 중지 - 사용자 명시적 요청 시에만
  const stopStreaming = useCallback(async () => {
    const elapsed = Date.now() - connectionStartTimeRef.current;
    console.log("[Camera] stopStreaming called, elapsed:", elapsed, "ms, isConnecting:", isConnectingRef.current);
    
    // 연결 시작 후 5초 이내면 중지 무시 (연결이 안정화될 때까지 대기)
    if (elapsed < 5000 && isConnectingRef.current) {
      console.log("[Camera] ⚠️ Ignoring stop - connection still stabilizing");
      return;
    }
    
    console.log("[Camera] ✅ Stopping streaming...");
    isConnectingRef.current = false;
    setIsStreaming(false);
    setIsWaitingForCamera(false);
    cleanupSubscription();

    // WebRTC 연결 종료
    disconnect();

    // 노트북에게 스트리밍 중지 요청
    await requestStreamingStop();
  }, [disconnect, requestStreamingStop, cleanupSubscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSubscription();
    };
  }, [cleanupSubscription]);

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
    const elapsed = Date.now() - connectionStartTimeRef.current;
    console.log("[Camera] handleClose called, isStreaming:", isStreaming, "elapsed:", elapsed, "ms");
    
    if (isStreaming) {
      // 연결 시작 후 5초 이내면 강제 종료하지 않음
      if (elapsed < 5000 && isConnectingRef.current) {
        console.log("[Camera] ⚠️ Modal closing during connection - will stop streaming in background");
      }
      
      // 모달이 닫힐 때는 무조건 정리
      isConnectingRef.current = false;
      connectionStartTimeRef.current = 0;
      setIsStreaming(false);
      setIsWaitingForCamera(false);
      cleanupSubscription();
      disconnect();
      
      // is_streaming_requested를 false로 설정 (강제)
      supabase
        .from("devices")
        .update({ is_streaming_requested: false })
        .eq("id", device.id)
        .then(() => console.log("[Camera] Streaming stopped on modal close"));
    }
    onClose();
  }, [isStreaming, disconnect, cleanupSubscription, device.id, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-primary rounded-2xl w-full max-w-[400px] overflow-hidden flex flex-col">
        <CameraHeader onClose={handleClose} deviceName={device.name} />

        <div className="p-4 flex flex-col gap-4">
          <CameraViewer
            isStreaming={isStreaming}
            isConnecting={isConnecting || isWaitingForCamera}
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
      </div>
    </div>
  );
};

export default CameraPage;
