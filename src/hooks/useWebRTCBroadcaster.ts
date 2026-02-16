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
  hasRemoteDescription: boolean;
  pendingIceCandidates: RTCIceCandidateInit[];
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
  const processedViewerJoinsRef = useRef<Set<string>>(new Set()); // Prevent duplicate viewer-join handling
  const sessionIdRef = useRef<string>(`broadcaster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      {
        urls: "turn:a.relay.metered.ca:80",
        username: "e8dd65e92f3940c5b29dbd07",
        credential: "mJLhNuL2ZiSJabcV",
      },
      {
        urls: "turn:a.relay.metered.ca:80?transport=tcp",
        username: "e8dd65e92f3940c5b29dbd07",
        credential: "mJLhNuL2ZiSJabcV",
      },
      {
        urls: "turn:a.relay.metered.ca:443",
        username: "e8dd65e92f3940c5b29dbd07",
        credential: "mJLhNuL2ZiSJabcV",
      },
      {
        urls: "turns:a.relay.metered.ca:443",
        username: "e8dd65e92f3940c5b29dbd07",
        credential: "mJLhNuL2ZiSJabcV",
      },
    ],
    iceCandidatePoolSize: 10,
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
    processedViewerJoinsRef.current.clear();
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

  // Helper function to extract SDP string from various formats
  const extractSdpFromData = useCallback((data: SignalingRecord['data']): string | undefined => {
    // Format 1: data.sdp is a string directly
    if (typeof data.sdp === 'string') {
      return data.sdp;
    }
    // Format 2: data.sdp is an object with sdp property (nested)
    if (data.sdp && typeof data.sdp === 'object' && 'sdp' in data.sdp) {
      return (data.sdp as { sdp: string }).sdp;
    }
    return undefined;
  }, []);

  const createPeerConnectionForViewer = useCallback(
    (viewerId: string) => {
      console.log("[WebRTC Broadcaster] Creating peer connection for viewer:", viewerId);
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local stream tracks to the connection
      if (localStreamRef.current) {
        console.log("[WebRTC Broadcaster] 📹 Local stream status:", {
          streamId: localStreamRef.current.id,
          active: localStreamRef.current.active,
          trackCount: localStreamRef.current.getTracks().length,
        });
        
        localStreamRef.current.getTracks().forEach((track, i) => {
          console.log(`[WebRTC Broadcaster] 📹 Adding track ${i}:`, {
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            id: track.id,
          });
          pc.addTrack(track, localStreamRef.current!);
        });
      } else {
        console.error("[WebRTC Broadcaster] ❌ No local stream available!");
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
      // ★ 3중 잠금: 중복 offer 전송 완전 차단
      // 1) processedViewerJoins — 이미 처리 시작된 viewerId
      if (processedViewerJoinsRef.current.has(viewerId)) {
        console.log("[WebRTC Broadcaster] ⏭️ Skipping duplicate viewer-join (processedSet):", viewerId);
        return;
      }
      
      // 2) viewerConnections — 이미 연결 객체가 존재
      if (viewerConnectionsRef.current.has(viewerId)) {
        console.log("[WebRTC Broadcaster] ⏭️ Viewer already has connection:", viewerId);
        return;
      }
      
      // ★ 즉시 잠금 — 모든 비동기 작업 전에 동기적으로 설정
      processedViewerJoinsRef.current.add(viewerId);
      
      console.log("[WebRTC Broadcaster] 👋 Viewer joined:", viewerId);
      console.log("[WebRTC Broadcaster] Local stream available:", !!localStreamRef.current);
      
      if (!localStreamRef.current) {
        console.error("[WebRTC Broadcaster] ❌ No local stream available, cannot create offer");
        processedViewerJoinsRef.current.delete(viewerId); // Allow retry
        return;
      }

      // Create peer connection for this viewer
      const pc = createPeerConnectionForViewer(viewerId);
      // ★ 연결 객체를 즉시 Map에 추가하여 두 번째 경로 차단
      viewerConnectionsRef.current.set(viewerId, { pc, viewerId, hasRemoteDescription: false, pendingIceCandidates: [] });
      setViewerCount(viewerConnectionsRef.current.size);

      try {
        // Create and send offer — 이 시점에서 이미 3중 잠금이 걸려있으므로 중복 불가
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
        processedViewerJoinsRef.current.delete(viewerId); // Allow retry on error
        setViewerCount(viewerConnectionsRef.current.size);
      }
    },
    [createPeerConnectionForViewer, sendSignalingMessage, onViewerConnected]
  );

  // viewer의 시그널링 메시지 처리
  const handleSignalingMessage = useCallback(
    async (record: SignalingRecord) => {
      // 이미 처리한 메시지 스킵 (메시지 ID 기반)
      if (processedMessagesRef.current.has(record.id)) {
        console.log("[WebRTC Broadcaster] ⏭️ Skipping already processed message:", record.id);
        return;
      }
      processedMessagesRef.current.add(record.id);

      console.log("[WebRTC Broadcaster] Processing message:", record.type, "from:", record.session_id);

      if (record.type === "viewer-join") {
        const viewerId = record.data.viewerId || record.session_id;
        handleViewerJoin(viewerId);
        return;
      }

      // answer의 경우 target_session을 확인하여 정확한 viewer 찾기
      const targetSession = record.data.target_session;
      const senderId = record.session_id;
      
      // viewer 연결 찾기: target_session > session_id > 첫 번째 연결
      let viewerConnection: ViewerConnection | undefined;
      
      if (targetSession && viewerConnectionsRef.current.has(targetSession)) {
        viewerConnection = viewerConnectionsRef.current.get(targetSession);
        console.log("[WebRTC Broadcaster] Found viewer by target_session:", targetSession);
      } else if (viewerConnectionsRef.current.has(senderId)) {
        viewerConnection = viewerConnectionsRef.current.get(senderId);
        console.log("[WebRTC Broadcaster] Found viewer by sender session_id:", senderId);
      } else {
        // 첫 번째 연결 사용 (단일 viewer 시나리오)
        const firstEntry = viewerConnectionsRef.current.entries().next().value;
        if (firstEntry) {
          viewerConnection = firstEntry[1];
          console.log("[WebRTC Broadcaster] Using first available viewer connection");
        }
      }
      
      if (!viewerConnection) {
        console.warn("[WebRTC Broadcaster] ⚠️ No viewer connection found for message:", record.type);
        return;
      }

      const { pc, hasRemoteDescription, viewerId } = viewerConnection;

      try {
        if (record.type === "answer") {
          // Skip if already processed
          if (hasRemoteDescription) {
            console.log("[WebRTC Broadcaster] ⏭️ Skipping duplicate answer for viewer:", viewerId);
            return;
          }
          
          // Extract SDP - handle multiple formats
          let sdp: string | undefined;
          if (typeof record.data.sdp === 'string') {
            sdp = record.data.sdp;
          } else if (record.data.sdp && typeof record.data.sdp === 'object' && 'sdp' in record.data.sdp) {
            sdp = (record.data.sdp as { sdp: string }).sdp;
          }
          
          if (sdp) {
            console.log("[WebRTC Broadcaster] ✅ Setting answer for viewer:", viewerId, "SDP length:", sdp.length);
            await pc.setRemoteDescription(new RTCSessionDescription({
              type: "answer",
              sdp: sdp,
            }));
            viewerConnection.hasRemoteDescription = true;
            console.log("[WebRTC Broadcaster] ✅ Remote description set successfully for viewer:", viewerId);
            
            // Flush pending ICE candidates
            if (viewerConnection.pendingIceCandidates.length > 0) {
              console.log("[WebRTC Broadcaster] Flushing", viewerConnection.pendingIceCandidates.length, "pending ICE candidates");
              for (const candidate of viewerConnection.pendingIceCandidates) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                  console.warn("[WebRTC Broadcaster] Failed to add buffered ICE candidate:", e);
                }
              }
              viewerConnection.pendingIceCandidates = [];
            }
          } else {
            console.error("[WebRTC Broadcaster] ❌ Invalid answer SDP format:", record.data);
          }
        } else if (record.type === "ice-candidate" && record.data.candidate) {
          if (!viewerConnection.hasRemoteDescription) {
            console.log("[WebRTC Broadcaster] ⏳ Buffering ICE candidate (remote description not set yet)");
            viewerConnection.pendingIceCandidates.push(record.data.candidate);
          } else {
            console.log("[WebRTC Broadcaster] Adding ICE candidate from viewer:", viewerId);
            await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
            console.log("[WebRTC Broadcaster] ✅ ICE candidate added");
          }
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
        audio: true,
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
        .subscribe(async (status) => {
          console.log("[WebRTC Broadcaster] Signaling channel status:", status);
          if (status === "SUBSCRIBED") {
            console.log("[WebRTC Broadcaster] ✅ Successfully subscribed to signaling channel");
            
            // 구독이 완전히 준비된 후에 기존 viewer-join 확인
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
            
            setIsBroadcasting(true);
          } else if (status === "CHANNEL_ERROR") {
            console.error("[WebRTC Broadcaster] ❌ Channel subscription error");
            onError?.("시그널링 채널 연결 실패");
          }
        });

      channelRef.current = channel;

      console.log("[WebRTC Broadcaster] Waiting for subscription to complete...");
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
