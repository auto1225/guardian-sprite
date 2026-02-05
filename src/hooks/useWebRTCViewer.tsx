import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface WebRTCViewerOptions {
  deviceId: string;
  onError?: (error: string) => void;
}

interface SignalingRecord {
  id: string;
  device_id: string;
  session_id: string;
  type: string;
  sender_type: string;
  data: {
    type?: string;
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  };
  created_at: string;
}

export const useWebRTCViewer = ({ deviceId, onError }: WebRTCViewerOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string>(`viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const processedMessagesRef = useRef<Set<string>>(new Set());

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    console.log("[WebRTC Viewer] Cleaning up...");
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    processedMessagesRef.current.clear();
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  // 시그널링 메시지를 테이블에 저장
  const sendSignalingMessage = useCallback(async (type: string, data: object) => {
    try {
      console.log("[WebRTC Viewer] Sending signaling:", type);
      const { error } = await supabase.from("webrtc_signaling").insert([{
        device_id: deviceId,
        session_id: sessionIdRef.current,
        type,
        sender_type: "viewer",
        data: JSON.parse(JSON.stringify(data)),
      }]);
      
      if (error) {
        console.error("[WebRTC Viewer] Failed to send signaling:", error);
        throw error;
      }
      console.log("[WebRTC Viewer] ✅ Signaling sent:", type);
    } catch (err) {
      console.error("[WebRTC Viewer] Signaling error:", err);
    }
  }, [deviceId]);

  const createPeerConnection = useCallback(() => {
    console.log("[WebRTC Viewer] Creating peer connection...");
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.ontrack = (event) => {
      console.log("[WebRTC Viewer] ✅ Received remote track:", event.track.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setIsConnected(true);
        setIsConnecting(false);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC Viewer] Sending ICE candidate");
        sendSignalingMessage("ice-candidate", { candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC Viewer] Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanup();
        onError?.("연결이 끊어졌습니다");
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC Viewer] ICE state:", pc.iceConnectionState);
    };

    return pc;
  }, [sendSignalingMessage, cleanup, onError]);

  // broadcaster의 시그널링 메시지 처리
  const handleSignalingMessage = useCallback(async (record: SignalingRecord) => {
    // 이미 처리한 메시지 스킵
    if (processedMessagesRef.current.has(record.id)) return;
    processedMessagesRef.current.add(record.id);

    const pc = peerConnectionRef.current;
    if (!pc) {
      console.warn("[WebRTC Viewer] No peer connection for message:", record.type);
      return;
    }

    try {
      if (record.type === "offer" && record.data.sdp) {
        console.log("[WebRTC Viewer] ✅ Received offer from broadcaster");
        await pc.setRemoteDescription(new RTCSessionDescription({
          type: "offer",
          sdp: record.data.sdp,
        }));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        console.log("[WebRTC Viewer] Sending answer...");
        await sendSignalingMessage("answer", { 
          type: "answer", 
          sdp: answer.sdp,
          target_session: record.session_id,
        });
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        console.log("[WebRTC Viewer] Received ICE candidate from broadcaster");
        await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
      }
    } catch (error) {
      console.error("[WebRTC Viewer] Error handling signaling:", error);
      onError?.("시그널링 오류가 발생했습니다");
    }
  }, [sendSignalingMessage, onError]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;
    
    console.log("[WebRTC Viewer] Starting connection...");
    setIsConnecting(true);
    cleanup();

    // 새 세션 ID 생성
    sessionIdRef.current = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 이전 시그널링 메시지 정리
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer");

      // PeerConnection 생성
      peerConnectionRef.current = createPeerConnection();

      // viewer-join 메시지 전송 (broadcaster에게 알림)
      await sendSignalingMessage("viewer-join", { 
        viewerId: sessionIdRef.current,
      });

      // Realtime으로 broadcaster의 응답 구독
      const channel = supabase
        .channel(`webrtc-signaling-${deviceId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "webrtc_signaling",
            filter: `device_id=eq.${deviceId}`,
          },
          (payload) => {
            const record = payload.new as SignalingRecord;
            // broadcaster의 메시지만 처리
            if (record.sender_type === "broadcaster") {
              console.log("[WebRTC Viewer] Received from broadcaster:", record.type);
              handleSignalingMessage(record);
            }
          }
        )
        .subscribe((status) => {
          console.log("[WebRTC Viewer] Signaling channel status:", status);
        });

      channelRef.current = channel;

      // 기존 offer가 있는지 확인 (노트북이 먼저 offer를 보냈을 수 있음)
      const { data: existingOffers } = await supabase
        .from("webrtc_signaling")
        .select("*")
        .eq("device_id", deviceId)
        .eq("sender_type", "broadcaster")
        .eq("type", "offer")
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingOffers && existingOffers.length > 0) {
        console.log("[WebRTC Viewer] Found existing offer, processing...");
        handleSignalingMessage(existingOffers[0] as SignalingRecord);
      }

      // 30초 타임아웃
      setTimeout(() => {
        if (!isConnected && isConnecting) {
          cleanup();
          onError?.("연결 시간이 초과되었습니다. 노트북 카메라가 활성화되어 있는지 확인하세요.");
        }
      }, 30000);

    } catch (error) {
      console.error("[WebRTC Viewer] Error connecting:", error);
      cleanup();
      onError?.("연결 중 오류가 발생했습니다");
    }
  }, [deviceId, isConnecting, isConnected, cleanup, createPeerConnection, sendSignalingMessage, handleSignalingMessage, onError]);

  const disconnect = useCallback(async () => {
    console.log("[WebRTC Viewer] Disconnecting...");
    // 먼저 연결 정리
    cleanup();
    
    // 시그널링 테이블에서 viewer 메시지 정리 (연결 종료 후)
    try {
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer");
    } catch (err) {
      console.error("[WebRTC Viewer] Cleanup error:", err);
    }
  }, [deviceId, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isConnecting,
    isConnected,
    remoteStream,
    connect,
    disconnect,
  };
};
