import { useState, useCallback, useEffect, useRef, forwardRef } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWebRTCViewer } from "@/hooks/useWebRTCViewer";
import CameraHeader from "@/components/camera/CameraHeader";
import CameraViewer from "@/components/camera/CameraViewer";
import CameraControls from "@/components/camera/CameraControls";
import SnapshotPreview from "@/components/camera/SnapshotPreview";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface CameraPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

const CameraPage = forwardRef<HTMLDivElement, CameraPageProps>(({ device, isOpen, onClose }, ref) => {
  const { toast } = useToast();
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaitingForCamera, setIsWaitingForCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false); // 기본: 소리 켜짐
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const waitingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isConnectingRef = useRef(false);
  const connectionStartTimeRef = useRef<number>(0);
  const isConnectedRef = useRef(false);
  const connectionSucceededAtRef = useRef(0); // 연결 성공 시각 (disconnect 보호용)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoStarted = useRef(false);

  const handleWebRTCError = useCallback((err: string) => {
    // 연결 해제("끊어") 및 실패("실패") 메시지는 항상 표시
    const isCriticalError = err.includes("실패") || err.includes("끊어") || err.includes("초과");
    if (!isCriticalError && isConnectedRef.current) return;
    if (!isCriticalError && !isConnectingRef.current && !isConnectedRef.current) return;
    console.log("[Camera] Error received:", err);
    setError(err);
    setIsStreaming(false);
    isConnectingRef.current = false;
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
    if (isConnected) {
      // 연결 성공 시 isConnectingRef 리셋 + 타임스탬프 기록
      isConnectingRef.current = false;
      connectionSucceededAtRef.current = Date.now();
      console.log("[Camera] ✅ Connection succeeded, isConnectingRef reset");
    }
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

  const startStreamingRef = useRef<() => Promise<void>>();

  const startStreaming = useCallback(async () => {
    if (isConnectingRef.current) return;
    // 이미 연결 중이거나 스트리밍 중이면 일단 정리 후 재시작
    if (isConnectedRef.current) {
      // 연결 성공 후 5초 이내에는 disconnect 방지 (레이스 컨디션 보호)
      const elapsed = Date.now() - connectionSucceededAtRef.current;
      if (elapsed < 5000) {
        console.log("[Camera] ⏭️ Skipping startStreaming — connected", elapsed, "ms ago (< 5s)");
        return;
      }
      console.log("[Camera] Cleaning up previous connection before restart...");
      disconnect();
      await new Promise(r => setTimeout(r, 500));
    }

    // 에러 상태 초기화
    setError(null);

    // 카메라 미연결 시 최신 DB 상태 확인
    const { data: latestDevice } = await supabase
      .from("devices")
      .select("is_camera_connected")
      .eq("id", device.id)
      .single();
    
    if (!latestDevice?.is_camera_connected) {
      setError(`${device.name} 카메라가 인식되지 않습니다.`);
      return;
    }

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
  }, [device.id, device.name, requestStreamingStart, waitForBroadcaster, connect, disconnect, cleanupSubscription]);

  // Ref에 최신 함수 유지 (useEffect dependency 순환 방지)
  useEffect(() => {
    startStreamingRef.current = startStreaming;
  }, [startStreaming]);

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
      startStreamingRef.current?.();
    }
    if (!isOpen) {
      hasAutoStarted.current = false;
    }
  }, [isOpen]);

  // 카메라 재연결 감지 → 자동 스트리밍 재시작
  useEffect(() => {
    if (!isOpen) return;
    
    const channel = supabase
      .channel(`camera-reconnect-${device.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${device.id}`,
        },
        (payload) => {
          const newDevice = payload.new as Device;
          const oldDevice = payload.old as Partial<Device>;
          
          // 카메라가 false → true로 변경되었고, 현재 스트리밍 중이 아닌 경우 자동 재시작
          if (
            newDevice.is_camera_connected &&
            oldDevice.is_camera_connected === false &&
            !isConnectingRef.current &&
            !isConnectedRef.current
          ) {
            console.log("[Camera] 📸 Camera reconnected, auto-restarting stream...");
            setError(null);
            // 약간의 딜레이 후 재시작 (카메라 안정화 대기)
            setTimeout(() => {
              if (!isConnectedRef.current && !isConnectingRef.current) {
                startStreamingRef.current?.();
              }
            }, 1500);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, device.id]);

  useEffect(() => {
    return () => { cleanupSubscription(); };
  }, [cleanupSubscription]);

  // 모바일 호환 다운로드 헬퍼 (공유 없이 직접 다운로드)
  const mobileDownload = useCallback(async (blob: Blob, filename: string) => {
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      // 모바일 브라우저 호환을 위해 약간의 딜레이 후 클릭
      await new Promise(r => setTimeout(r, 100));
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 2000);
      toast({ title: "저장 완료", description: filename });
    } catch (err) {
      console.error("[Camera] Download failed:", err);
      toast({ title: "저장 실패", description: "파일을 저장할 수 없습니다.", variant: "destructive" });
    }
  }, [toast]);

  // 녹화 시작/중지
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      // 중지
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      // onstop 핸들러에서 다운로드 처리하므로 ref는 onstop 후 정리
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
      recorder.onstop = async () => {
        console.log("[Camera] Recording stopped, chunks:", recordedChunksRef.current.length);
        if (recordedChunksRef.current.length === 0) {
          console.warn("[Camera] No recorded chunks available");
          toast({ title: "녹화 실패", description: "녹화된 데이터가 없습니다.", variant: "destructive" });
          mediaRecorderRef.current = null;
          return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        console.log("[Camera] Recording blob size:", blob.size);
        const filename = `meercop-recording-${Date.now()}.webm`;
        await mobileDownload(blob, filename);
        recordedChunksRef.current = [];
        mediaRecorderRef.current = null;
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (err) {
      console.error("[Camera] Recording failed:", err);
    }
  }, [isRecording, remoteStream, mobileDownload]);

  // 일시정지/재개 (비디오만 시각적으로 정지, WebRTC 연결은 유지)
  const togglePause = useCallback(() => {
    const video = document.querySelector('video');
    if (!video) return;
    const newPaused = !isPaused;
    if (newPaused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
    setIsPaused(newPaused);
  }, [isPaused]);

  // 스냅샷 (미리보기로 표시)
  const captureSnapshot = useCallback(() => {
    if (!remoteStream) return;
    try {
      const video = document.querySelector('video');
      if (!video || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        setSnapshotUrl(canvas.toDataURL("image/jpeg", 0.9));
      }
    } catch (err) {
      console.error("Failed to capture snapshot:", err);
    }
  }, [remoteStream]);

  const downloadSnapshot = useCallback(async () => {
    if (!snapshotUrl) return;
    try {
      const res = await fetch(snapshotUrl);
      const blob = await res.blob();
      const filename = `meercop-snapshot-${device.name}-${Date.now()}.jpg`;
      await mobileDownload(blob, filename);
    } catch (err) {
      console.error("[Camera] Snapshot download failed:", err);
    }
  }, [snapshotUrl, device.name, mobileDownload]);

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

        <div className="px-2 pb-2 flex flex-col gap-2 relative">
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
          {snapshotUrl && (
            <SnapshotPreview
              imageUrl={snapshotUrl}
              onClose={() => setSnapshotUrl(null)}
              onDownload={downloadSnapshot}
            />
          )}
        </div>

        <CameraControls
          isStreaming={isStreaming}
          isPaused={isPaused}
          onTogglePause={togglePause}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          isRecording={isRecording}
          onToggleRecording={toggleRecording}
          onCapture={captureSnapshot}
        />
      </div>
    </div>
  );
});

CameraPage.displayName = "CameraPage";

export default CameraPage;
