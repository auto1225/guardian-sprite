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
  const [isMuted, setIsMuted] = useState(false); // 기본: 소리 켜짐
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const waitingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isConnectingRef = useRef(false);
  const connectionStartTimeRef = useRef<number>(0);
  const isConnectedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoStarted = useRef(false);

  const handleWebRTCError = useCallback((err: string) => {
    if (isConnectedRef.current && !err.includes("실패")) return;
    if (!isConnectingRef.current && !isConnectedRef.current) return;
    setError(err);
    toast({ title: "연결 오류", description: err, variant: "destructive" });
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

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const requestStreamingStart = useCallback(async () => {
    try {
      await supabase.from("devices").update({ is_streaming_requested: true }).eq("id", device.id);
    } catch (err) {
      console.error("[Camera] Failed to request streaming:", err);
    }
  }, [device.id]);

  const requestStreamingStop = useCallback(async () => {
    const elapsed = Date.now() - connectionStartTimeRef.current;
    if (elapsed < 5000 && isConnectingRef.current) return;
    try {
      await supabase.from("devices").update({ is_streaming_requested: false }).eq("id", device.id);
    } catch (err) {
      console.error("[Camera] Failed to stop streaming:", err);
    }
  }, [device.id]);

  const cleanupSubscription = useCallback(() => {
    if (waitingTimeoutRef.current) { clearTimeout(waitingTimeoutRef.current); waitingTimeoutRef.current = null; }
    if (subscriptionRef.current) { supabase.removeChannel(subscriptionRef.current); subscriptionRef.current = null; }
  }, []);

  const waitForBroadcaster = useCallback(async (): Promise<boolean> => {
    for (let i = 0; i < 30; i++) {
      if (!isConnectingRef.current) return false;
      const { data } = await supabase.from("devices").select("is_camera_connected").eq("id", device.id).single();
      if (data?.is_camera_connected) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }, [device.id]);

  const startStreaming = useCallback(async () => {
    if (isConnectingRef.current || isStreaming) return;

    isConnectingRef.current = true;
    connectionStartTimeRef.current = Date.now();
    setIsStreaming(true);
    setIsWaitingForCamera(true);
    setError(null);

    await requestStreamingStart();
    const isReady = await waitForBroadcaster();

    if (!isReady) {
      isConnectingRef.current = false;
      setIsWaitingForCamera(false);
      setIsStreaming(false);
      setError("노트북 카메라 응답 시간 초과. 노트북 앱이 실행 중인지 확인하세요.");
      return;
    }

    await new Promise(r => setTimeout(r, 1000));
    if (!isConnectingRef.current) return;

    setIsWaitingForCamera(false);
    connect();

    waitingTimeoutRef.current = setTimeout(() => {
      if (isConnectedRef.current) return;
      if (isConnectingRef.current && !isConnectedRef.current) {
        isConnectingRef.current = false;
        cleanupSubscription();
        setIsStreaming(false);
        setError("WebRTC 연결 시간 초과. 다시 시도해주세요.");
      }
    }, 30000);
  }, [isStreaming, requestStreamingStart, waitForBroadcaster, connect, cleanupSubscription]);

  const stopStreaming = useCallback(async () => {
    const elapsed = Date.now() - connectionStartTimeRef.current;
    if (elapsed < 5000 && isConnectingRef.current) return;

    // 녹화 중이면 중지
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingDuration(0);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }

    isConnectingRef.current = false;
    setIsStreaming(false);
    setIsWaitingForCamera(false);
    cleanupSubscription();
    disconnect();
    await requestStreamingStop();
  }, [disconnect, requestStreamingStop, cleanupSubscription]);

  // 모달 열릴 때 자동 시작
  useEffect(() => {
    if (isOpen && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startStreaming();
    }
    if (!isOpen) {
      hasAutoStarted.current = false;
    }
  }, [isOpen, startStreaming]);

  useEffect(() => {
    return () => { cleanupSubscription(); };
  }, [cleanupSubscription]);

  // 녹화 시작/중지
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      // 중지
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingDuration(0);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      return;
    }

    if (!remoteStream) return;
    const videoTracks = remoteStream.getVideoTracks();
    const audioTracks = remoteStream.getAudioTracks();
    const recordingStream = new MediaStream();
    videoTracks.forEach(t => recordingStream.addTrack(t));
    audioTracks.forEach(t => recordingStream.addTrack(t));
    recordedChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";

    try {
      const recorder = new MediaRecorder(recordingStream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `meercop-recording-${Date.now()}.webm`;
        link.click();
        URL.revokeObjectURL(url);
        recordedChunksRef.current = [];
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (err) {
      console.error("[Camera] Recording failed:", err);
    }
  }, [isRecording, remoteStream]);

  // 스냅샷
  const captureSnapshot = useCallback(() => {
    if (!remoteStream) { toast({ title: "오류", description: "스트리밍이 활성화되지 않았습니다", variant: "destructive" }); return; }
    try {
      const video = document.querySelector('video');
      if (!video || video.videoWidth === 0) { toast({ title: "오류", description: "비디오가 준비되지 않았습니다", variant: "destructive" }); return; }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/jpeg", 0.9);
        link.download = `meercop-snapshot-${device.name}-${Date.now()}.jpg`;
        link.click();
        toast({ title: "스냅샷 저장 완료", description: "갤러리에서 확인하세요" });
      }
    } catch (err) {
      console.error("Failed to capture snapshot:", err);
      toast({ title: "오류", description: "스냅샷 캡처에 실패했습니다", variant: "destructive" });
    }
  }, [remoteStream, device.name, toast]);

  // 다운로드 (스냅샷과 동일)
  const handleDownload = useCallback(() => {
    const video = document.querySelector('video');
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", 0.9);
      link.download = `meercop-capture-${Date.now()}.jpg`;
      link.click();
    }
  }, []);

  const handleToggleMute = useCallback(() => setIsMuted(m => !m), []);

  const handleClose = useCallback(() => {
    if (isStreaming) {
      // 녹화 정리
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

      isConnectingRef.current = false;
      connectionStartTimeRef.current = 0;
      setIsStreaming(false);
      setIsWaitingForCamera(false);
      setIsRecording(false);
      setRecordingDuration(0);
      cleanupSubscription();
      disconnect();
      supabase.from("devices").update({ is_streaming_requested: false }).eq("id", device.id);
    }
    onClose();
  }, [isStreaming, disconnect, cleanupSubscription, device.id, onClose]);

  // 언마운트 시 녹화 정리
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className="rounded-2xl w-full max-w-[400px] overflow-hidden flex flex-col border border-white/25 shadow-2xl"
        style={{
          background: 'linear-gradient(180deg, hsla(200, 70%, 55%, 0.88) 0%, hsla(210, 60%, 40%, 0.92) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        <CameraHeader onClose={handleClose} deviceName={device.name} />

        <div className="px-2 pb-2 flex flex-col gap-2">
          <CameraViewer
            isStreaming={isStreaming}
            isConnecting={isConnecting || isWaitingForCamera}
            isConnected={isConnected}
            remoteStream={remoteStream}
            error={error}
            onRetry={startStreaming}
            isMuted={isMuted}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
          />
        </div>

        <CameraControls
          isStreaming={isStreaming}
          onStop={stopStreaming}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          isRecording={isRecording}
          onToggleRecording={toggleRecording}
          onCapture={captureSnapshot}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
};

export default CameraPage;
