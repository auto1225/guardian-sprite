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
  const isConnectingRef = useRef(false); // Sync guard for race conditions

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    console.log("[WebRTC Viewer] Cleaning up... isConnecting:", isConnectingRef.current);
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
    // Don't reset isConnectingRef here - let the caller control it
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
        console.log("[WebRTC Viewer] ✅ Peer connection established!");
        isConnectingRef.current = false; // Connection complete
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        if (isConnectingRef.current) {
          // Only trigger error if we were actually trying to connect
          isConnectingRef.current = false;
          cleanup();
          onError?.("연결이 끊어졌습니다");
        }
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
    // Use ref for synchronous check to prevent race conditions
    if (isConnectingRef.current || isConnected) {
      console.log("[WebRTC Viewer] Already connecting or connected, skipping...");
      return;
    }
    
    isConnectingRef.current = true;
    console.log("[WebRTC Viewer] Starting connection...");
    setIsConnecting(true);
    
    // Don't cleanup at start - just reset refs
    processedMessagesRef.current.clear();

    // 새 세션 ID 생성
    sessionIdRef.current = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 이전 시그널링 메시지 정리 (don't await to avoid delay)
      supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer")
        .then(() => console.log("[WebRTC Viewer] Old signaling cleaned"));

      // PeerConnection 생성
      peerConnectionRef.current = createPeerConnection();

      // viewer-join 메시지 전송 (broadcaster에게 알림)
      await sendSignalingMessage("viewer-join", { 
        viewerId: sessionIdRef.current,
      });

      // Realtime으로 broadcaster의 응답 구독
      const channelName = `webrtc-signaling-${deviceId}-${Date.now()}`;
      console.log("[WebRTC Viewer] Subscribing to channel:", channelName);
      
      const channel = supabase
        .channel(channelName)
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
            console.log("[WebRTC Viewer] Received signaling:", record.type, "from:", record.sender_type);
            // broadcaster의 메시지만 처리
            if (record.sender_type === "broadcaster") {
              console.log("[WebRTC Viewer] ✅ Processing broadcaster message:", record.type);
              handleSignalingMessage(record);
            }
          }
        )
        .subscribe((status) => {
          console.log("[WebRTC Viewer] Signaling channel status:", status);
          
          // 구독 완료 후 기존 offer 확인
          if (status === "SUBSCRIBED") {
            console.log("[WebRTC Viewer] Channel subscribed, checking for existing offer...");
            checkForExistingOffer();
          }
        });

      channelRef.current = channel;

      // 기존 offer 확인 함수
      const checkForExistingOffer = async () => {
        const { data: existingOffers, error } = await supabase
          .from("webrtc_signaling")
          .select("*")
          .eq("device_id", deviceId)
          .eq("sender_type", "broadcaster")
          .eq("type", "offer")
          .order("created_at", { ascending: false })
          .limit(1);

        if (error) {
          console.error("[WebRTC Viewer] Error checking existing offer:", error);
          return;
        }

        if (existingOffers && existingOffers.length > 0) {
          console.log("[WebRTC Viewer] ✅ Found existing offer, processing...");
          handleSignalingMessage(existingOffers[0] as SignalingRecord);
        } else {
          console.log("[WebRTC Viewer] No existing offer found, waiting for broadcaster...");
        }
      };

      // 30초 타임아웃
      setTimeout(() => {
        if (isConnectingRef.current && !isConnected) {
          console.log("[WebRTC Viewer] Connection timeout");
          isConnectingRef.current = false;
          cleanup();
          onError?.("연결 시간이 초과되었습니다. 노트북 카메라가 활성화되어 있는지 확인하세요.");
        }
      }, 30000);

    } catch (error) {
      console.error("[WebRTC Viewer] Error connecting:", error);
      isConnectingRef.current = false;
      cleanup();
      onError?.("연결 중 오류가 발생했습니다");
    }
  }, [deviceId, isConnected, cleanup, createPeerConnection, sendSignalingMessage, handleSignalingMessage, onError]);

  const disconnect = useCallback(async () => {
    console.log("[WebRTC Viewer] Disconnecting..., wasConnecting:", isConnectingRef.current);
    isConnectingRef.current = false;
    
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
