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
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false); // Track connection status with ref
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]); // Buffer for ICE candidates
  const hasRemoteDescriptionRef = useRef(false); // Track if remote description is set
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout reference

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    console.log("[WebRTC Viewer] Cleaning up... isConnecting:", isConnectingRef.current);
    
    // Clear timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    processedMessagesRef.current.clear();
    pendingIceCandidatesRef.current = [];
    hasRemoteDescriptionRef.current = false;
    isConnectedRef.current = false;
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
      
      // Debug track status
      const track = event.track;
      console.log("[WebRTC Viewer] 📹 Track details:", {
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        id: track.id,
      });
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        console.log("[WebRTC Viewer] 📹 Stream details:", {
          id: stream.id,
          active: stream.active,
          trackCount: stream.getTracks().length,
        });
        
        // Log all tracks in the stream
        stream.getTracks().forEach((t, i) => {
          console.log(`[WebRTC Viewer] 📹 Stream track ${i}:`, {
            kind: t.kind,
            enabled: t.enabled,
            muted: t.muted,
            readyState: t.readyState,
          });
        });
        
        // Clear timeout - connection successful!
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
          console.log("[WebRTC Viewer] ✅ Connection timeout cleared - track received");
        }
        
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        setRemoteStream(stream);
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
        
        // Clear timeout on successful connection
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        if (isConnectingRef.current) {
          // Only trigger error if we were actually trying to connect
          isConnectingRef.current = false;
          isConnectedRef.current = false;
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

  // Process buffered ICE candidates after remote description is set
  const processPendingIceCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !hasRemoteDescriptionRef.current) return;

    console.log("[WebRTC Viewer] Processing", pendingIceCandidatesRef.current.length, "pending ICE candidates");
    
    for (const candidate of pendingIceCandidatesRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("[WebRTC Viewer] Failed to add buffered ICE candidate:", err);
      }
    }
    pendingIceCandidatesRef.current = [];
  }, []);

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
      if (record.type === "offer") {
        // Debug: log the data structure
        console.log("[WebRTC Viewer] ✅ Received offer, data:", JSON.stringify(record.data));
        
        // Extract SDP - handle both formats:
        // Format 1: { type: "offer", sdp: "v=0..." }
        // Format 2: { sdp: { type: "offer", sdp: "v=0..." } } (nested)
        let sdp: string | undefined;
        
        if (typeof record.data.sdp === 'string') {
          // Format 1: sdp is a string
          sdp = record.data.sdp;
        } else if (record.data.sdp && typeof record.data.sdp === 'object' && 'sdp' in record.data.sdp) {
          // Format 2: sdp is nested object
          sdp = (record.data.sdp as { sdp: string }).sdp;
          console.log("[WebRTC Viewer] Using nested SDP format");
        }
        
        if (!sdp || typeof sdp !== 'string') {
          console.error("[WebRTC Viewer] Invalid SDP format:", typeof record.data.sdp, record.data.sdp);
          onError?.("잘못된 SDP 형식입니다");
          return;
        }

        console.log("[WebRTC Viewer] Setting remote description with SDP length:", sdp.length);
        await pc.setRemoteDescription(new RTCSessionDescription({
          type: "offer",
          sdp: sdp,
        }));
        
        hasRemoteDescriptionRef.current = true;
        console.log("[WebRTC Viewer] ✅ Remote description set successfully");
        
        // Process any buffered ICE candidates
        await processPendingIceCandidates();
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        console.log("[WebRTC Viewer] Sending answer...");
        await sendSignalingMessage("answer", { 
          type: "answer", 
          sdp: answer.sdp,
          target_session: record.session_id,
        });
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        if (!hasRemoteDescriptionRef.current) {
          // Buffer the ICE candidate for later
          console.log("[WebRTC Viewer] Buffering ICE candidate (remote description not set yet)");
          pendingIceCandidatesRef.current.push(record.data.candidate);
        } else {
          console.log("[WebRTC Viewer] Adding ICE candidate");
          await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
        }
      }
    } catch (error) {
      console.error("[WebRTC Viewer] Error handling signaling:", error);
      onError?.("시그널링 오류가 발생했습니다");
    }
  }, [sendSignalingMessage, onError, processPendingIceCandidates]);

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

      // 30초 타임아웃 - ref를 사용하여 올바른 상태 확인
      connectionTimeoutRef.current = setTimeout(() => {
        if (isConnectingRef.current && !isConnectedRef.current) {
          console.log("[WebRTC Viewer] Connection timeout - isConnecting:", isConnectingRef.current, "isConnected:", isConnectedRef.current);
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
