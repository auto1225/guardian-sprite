import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface WebRTCBroadcasterOptions {
  deviceId: string;
  onError?: (error: string) => void;
  onViewerConnected?: (viewerId: string) => void;
  onViewerDisconnected?: (viewerId: string) => void;
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
    viewerId?: string;
    target_session?: string;
  };
  created_at: string;
}

interface ViewerConnection {
  pc: RTCPeerConnection;
  viewerId: string;
}

export const useWebRTCBroadcaster = ({
  deviceId,
  onError,
  onViewerConnected,
  onViewerDisconnected,
}: WebRTCBroadcasterOptions) => {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);

  const viewerConnectionsRef = useRef<Map<string, ViewerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef<string>(`broadcaster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    console.log("[WebRTC Broadcaster] Cleaning up...");
    
    // Close all peer connections
    viewerConnectionsRef.current.forEach(({ pc, viewerId }) => {
      pc.close();
      onViewerDisconnected?.(viewerId);
    });
    viewerConnectionsRef.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Remove channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    processedMessagesRef.current.clear();
    setLocalStream(null);
    setIsBroadcasting(false);
    setViewerCount(0);
  }, [onViewerDisconnected]);

  // 테이블 기반 시그널링 메시지 전송
  const sendSignalingMessage = useCallback(async (type: string, data: object, targetSession?: string) => {
    try {
      console.log("[WebRTC Broadcaster] Sending signaling:", type);
      const { error } = await supabase.from("webrtc_signaling").insert([{
        device_id: deviceId,
        session_id: sessionIdRef.current,
        type,
        sender_type: "broadcaster",
        data: JSON.parse(JSON.stringify({
          ...data,
          target_session: targetSession,
        })),
      }]);
      
      if (error) {
        console.error("[WebRTC Broadcaster] Failed to send signaling:", error);
        throw error;
      }
      console.log("[WebRTC Broadcaster] ✅ Signaling sent:", type);
    } catch (err) {
      console.error("[WebRTC Broadcaster] Signaling error:", err);
    }
  }, [deviceId]);

  const createPeerConnectionForViewer = useCallback(
    (viewerId: string) => {
      console.log("[WebRTC Broadcaster] Creating peer connection for viewer:", viewerId);
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local stream tracks to the connection
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          console.log("[WebRTC Broadcaster] Adding track:", track.kind);
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[WebRTC Broadcaster] Sending ICE candidate to viewer");
          sendSignalingMessage("ice-candidate", { candidate: event.candidate.toJSON() }, viewerId);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC Broadcaster] Connection state with ${viewerId}:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          console.log("[WebRTC Broadcaster] ✅ Connected to viewer:", viewerId);
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          // Remove this viewer
          viewerConnectionsRef.current.delete(viewerId);
          setViewerCount(viewerConnectionsRef.current.size);
          onViewerDisconnected?.(viewerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC Broadcaster] ICE state with ${viewerId}:`, pc.iceConnectionState);
      };

      return pc;
    },
    [sendSignalingMessage, onViewerDisconnected]
  );

  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      console.log("[WebRTC Broadcaster] 👋 Viewer joined:", viewerId);
      console.log("[WebRTC Broadcaster] Local stream available:", !!localStreamRef.current);
      
      if (!localStreamRef.current) {
        console.error("[WebRTC Broadcaster] ❌ No local stream available, cannot create offer");
        return;
      }

      // 이미 연결된 viewer인지 확인
      if (viewerConnectionsRef.current.has(viewerId)) {
        console.log("[WebRTC Broadcaster] Viewer already connected:", viewerId);
        return;
      }

      // Create peer connection for this viewer
      const pc = createPeerConnectionForViewer(viewerId);
      viewerConnectionsRef.current.set(viewerId, { pc, viewerId });
      setViewerCount(viewerConnectionsRef.current.size);

      try {
        // Create and send offer
        console.log("[WebRTC Broadcaster] Creating offer for viewer:", viewerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("[WebRTC Broadcaster] Offer created, sending to viewer...");

        await sendSignalingMessage("offer", { 
          type: "offer", 
          sdp: offer.sdp,
        }, viewerId);
        
        console.log("[WebRTC Broadcaster] ✅ Offer sent to viewer:", viewerId);
        onViewerConnected?.(viewerId);
      } catch (error) {
        console.error("[WebRTC Broadcaster] ❌ Error creating offer for viewer:", error);
        pc.close();
        viewerConnectionsRef.current.delete(viewerId);
        setViewerCount(viewerConnectionsRef.current.size);
      }
    },
    [createPeerConnectionForViewer, sendSignalingMessage, onViewerConnected]
  );

  // viewer의 시그널링 메시지 처리
  const handleSignalingMessage = useCallback(
    async (record: SignalingRecord) => {
      // 이미 처리한 메시지 스킵
      if (processedMessagesRef.current.has(record.id)) return;
      processedMessagesRef.current.add(record.id);

      console.log("[WebRTC Broadcaster] Processing message:", record.type, "from:", record.session_id);

      if (record.type === "viewer-join") {
        const viewerId = record.data.viewerId || record.session_id;
        handleViewerJoin(viewerId);
        return;
      }

      // answer 또는 ice-candidate 처리
      const viewerId = record.session_id;
      const viewerConnection = viewerConnectionsRef.current.get(record.data.viewerId || viewerId);
      
      if (!viewerConnection) {
        // viewerId로 찾지 못하면 모든 연결에서 찾기
        let foundConnection: ViewerConnection | undefined;
        viewerConnectionsRef.current.forEach((conn) => {
          if (!foundConnection) foundConnection = conn;
        });
        
        if (!foundConnection) {
          console.warn("[WebRTC Broadcaster] Received message from unknown viewer:", viewerId);
          return;
        }
        
        const { pc } = foundConnection;
        
        try {
          if (record.type === "answer" && record.data.sdp) {
            console.log("[WebRTC Broadcaster] ✅ Received answer from viewer");
            await pc.setRemoteDescription(new RTCSessionDescription({
              type: "answer",
              sdp: record.data.sdp,
            }));
          } else if (record.type === "ice-candidate" && record.data.candidate) {
            console.log("[WebRTC Broadcaster] Received ICE candidate from viewer");
            await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
          }
        } catch (error) {
          console.error("[WebRTC Broadcaster] Error handling signaling message:", error);
        }
        return;
      }

      const { pc } = viewerConnection;

      try {
        if (record.type === "answer" && record.data.sdp) {
          console.log("[WebRTC Broadcaster] ✅ Received answer from viewer:", viewerId);
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: "answer",
            sdp: record.data.sdp,
          }));
        } else if (record.type === "ice-candidate" && record.data.candidate) {
          console.log("[WebRTC Broadcaster] Received ICE candidate from viewer:", viewerId);
          await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
        }
      } catch (error) {
        console.error("[WebRTC Broadcaster] Error handling signaling message:", error);
      }
    },
    [handleViewerJoin]
  );

  const startBroadcasting = useCallback(async () => {
    if (isBroadcasting) return;

    console.log("[WebRTC Broadcaster] Starting broadcast...");
    sessionIdRef.current = `broadcaster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Get local camera stream
      console.log("[WebRTC Broadcaster] Requesting camera access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });

      console.log("[WebRTC Broadcaster] ✅ Camera access granted, tracks:", stream.getTracks().length);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // 이전 broadcaster 시그널링 메시지 정리
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "broadcaster");

      // Realtime으로 viewer의 메시지 구독 (테이블 기반)
      const channel = supabase
        .channel(`webrtc-signaling-broadcaster-${deviceId}`)
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
            // viewer의 메시지만 처리
            if (record.sender_type === "viewer") {
              console.log("[WebRTC Broadcaster] Received from viewer:", record.type);
              handleSignalingMessage(record);
            }
          }
        )
        .subscribe((status) => {
          console.log("[WebRTC Broadcaster] Signaling channel status:", status);
          if (status === "SUBSCRIBED") {
            console.log("[WebRTC Broadcaster] ✅ Successfully subscribed to signaling channel");
            setIsBroadcasting(true);
          } else if (status === "CHANNEL_ERROR") {
            console.error("[WebRTC Broadcaster] ❌ Channel subscription error");
            onError?.("시그널링 채널 연결 실패");
          }
        });

      channelRef.current = channel;

      // 기존 viewer-join이 있는지 확인 (viewer가 먼저 요청했을 수 있음)
      const { data: existingViewerJoins } = await supabase
        .from("webrtc_signaling")
        .select("*")
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer")
        .eq("type", "viewer-join")
        .order("created_at", { ascending: false });

      if (existingViewerJoins && existingViewerJoins.length > 0) {
        console.log("[WebRTC Broadcaster] Found existing viewer-join requests:", existingViewerJoins.length);
        for (const record of existingViewerJoins) {
          handleSignalingMessage(record as SignalingRecord);
        }
      }

      console.log("[WebRTC Broadcaster] Started broadcasting");
    } catch (error) {
      console.error("[WebRTC Broadcaster] Error starting broadcast:", error);
      cleanup();
      onError?.("카메라 접근에 실패했습니다. 권한을 확인해주세요.");
    }
  }, [deviceId, isBroadcasting, cleanup, handleSignalingMessage, onError]);

  const stopBroadcasting = useCallback(async () => {
    // 시그널링 테이블에서 broadcaster 메시지 정리
    try {
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "broadcaster");
    } catch (err) {
      console.error("[WebRTC Broadcaster] Cleanup error:", err);
    }
    
    cleanup();
    console.log("[WebRTC Broadcaster] Stopped broadcasting");
  }, [deviceId, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isBroadcasting,
    localStream,
    viewerCount,
    startBroadcasting,
    stopBroadcasting,
  };
};
