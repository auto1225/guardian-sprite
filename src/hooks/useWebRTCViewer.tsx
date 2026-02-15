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
  const hasSentAnswerRef = useRef(false); // Track if answer has been sent
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout reference
  const offerRetryCountRef = useRef(0); // Track offer retry count
  const offerRetryIntervalRef = useRef<NodeJS.Timeout | null>(null); // Retry interval

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
    console.log("[WebRTC Viewer] Cleaning up... isConnecting:", isConnectingRef.current);
    
    // Clear timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    
    // Clear retry interval
    if (offerRetryIntervalRef.current) {
      clearInterval(offerRetryIntervalRef.current);
      offerRetryIntervalRef.current = null;
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
    hasSentAnswerRef.current = false;
    offerRetryCountRef.current = 0;
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
        
        // Track ended 이벤트 모니터링 - 트랙이 끝나도 바로 종료하지 않음
        track.onended = () => {
          console.log("[WebRTC Viewer] ⚠️ Track ended:", track.kind);
          // 트랙이 끝나도 연결은 유지 - broadcaster에서 다시 보낼 수 있음
        };
        
        track.onmute = () => {
          console.log("[WebRTC Viewer] ⚠️ Track muted:", track.kind);
        };
        
        track.onunmute = () => {
          console.log("[WebRTC Viewer] ✅ Track unmuted:", track.kind);
        };
        
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
      } else if (pc.connectionState === "disconnected") {
        // disconnected는 일시적일 수 있으므로 바로 종료하지 않음
        // 10초 대기 후에도 복구되지 않으면 종료
        console.log("[WebRTC Viewer] ⚠️ Connection disconnected, waiting for recovery...");
        setTimeout(() => {
          if (peerConnectionRef.current?.connectionState === "disconnected") {
            console.log("[WebRTC Viewer] Connection did not recover after 10s");
            isConnectingRef.current = false;
            isConnectedRef.current = false;
            cleanup();
            onError?.("연결이 끊어졌습니다");
          }
        }, 10000);
      } else if (pc.connectionState === "failed") {
        // failed는 즉시 종료
        console.log("[WebRTC Viewer] Connection failed");
        isConnectingRef.current = false;
        isConnectedRef.current = false;
        cleanup();
        onError?.("연결에 실패했습니다");
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC Viewer] ICE state:", pc.iceConnectionState);
      
      // ICE 연결이 disconnected가 되어도 바로 종료하지 않음
      // checking -> connected -> completed 흐름이 정상
      // disconnected는 일시적일 수 있음
      if (pc.iceConnectionState === "failed") {
        console.log("[WebRTC Viewer] ❌ ICE connection failed");
        // failed만 즉시 처리, disconnected는 connectionState에서 처리
      } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        console.log("[WebRTC Viewer] ✅ ICE connection established");
      }
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
        // 자신의 세션 ID와 일치하는 offer만 처리
        if (record.session_id !== sessionIdRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Ignoring offer for different session:", record.session_id, "my session:", sessionIdRef.current);
          return;
        }
        
        // Skip duplicate offers - if we already sent an answer
        if (hasSentAnswerRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Skipping duplicate offer (already sent answer)");
          return;
        }
        // Also skip if we already have a remote description set
        if (hasRemoteDescriptionRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Skipping duplicate offer (already have remote description)");
          return;
        }
        // Debug: log the data structure
        console.log("[WebRTC Viewer] ✅ Received offer for my session:", record.session_id);
        
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
        
        // Only create and send answer if we haven't already
        if (!hasSentAnswerRef.current) {
          hasSentAnswerRef.current = true;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          console.log("[WebRTC Viewer] Sending answer for session:", sessionIdRef.current);
          await sendSignalingMessage("answer", { 
            type: "answer", 
            sdp: answer.sdp,
            target_session: sessionIdRef.current, // 자신의 세션 ID 사용
          });
        } else {
          console.log("[WebRTC Viewer] ⏭️ Answer already sent, skipping...");
        }
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        // ICE candidate도 자신의 세션과 일치하는 것만 처리
        if (record.session_id !== sessionIdRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Ignoring ICE candidate for different session");
          return;
        }
        
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

    // 기존 offer 확인 함수 - 먼저 정의
    const checkForExistingOffer = async (): Promise<boolean> => {
      const { data: existingOffers, error: fetchError } = await supabase
        .from("webrtc_signaling")
        .select("*")
        .eq("device_id", deviceId)
        .eq("sender_type", "broadcaster")
        .eq("type", "offer")
        .order("created_at", { ascending: false })
        .limit(1);

      if (fetchError) {
        console.error("[WebRTC Viewer] Error checking existing offer:", fetchError);
        return false;
      }

      if (existingOffers && existingOffers.length > 0) {
        console.log("[WebRTC Viewer] ✅ Found existing offer, processing...");
        handleSignalingMessage(existingOffers[0] as SignalingRecord);
        return true;
      } else {
        console.log("[WebRTC Viewer] No existing offer found, waiting for broadcaster...");
        return false;
      }
    };

    // Offer 재요청 로직 - 2초마다 최대 5회 viewer-join 재전송
    const startOfferRetry = () => {
      offerRetryCountRef.current = 0;
      offerRetryIntervalRef.current = setInterval(async () => {
        // 이미 offer를 받았거나 연결됐으면 중지
        if (hasRemoteDescriptionRef.current || isConnectedRef.current || !isConnectingRef.current) {
          if (offerRetryIntervalRef.current) {
            clearInterval(offerRetryIntervalRef.current);
            offerRetryIntervalRef.current = null;
          }
          return;
        }
        
        offerRetryCountRef.current++;
        console.log(`[WebRTC Viewer] 🔄 Retry ${offerRetryCountRef.current}/5: Checking for offer or re-sending viewer-join...`);
        
        // 먼저 기존 offer 확인
        const foundOffer = await checkForExistingOffer();
        
        if (!foundOffer && offerRetryCountRef.current <= 5) {
          // offer가 없으면 viewer-join 재전송
          console.log("[WebRTC Viewer] Re-sending viewer-join...");
          await sendSignalingMessage("viewer-join", { 
            viewerId: sessionIdRef.current,
            retry: offerRetryCountRef.current,
          });
        }
        
        // 5회 초과하면 중지
        if (offerRetryCountRef.current >= 5) {
          if (offerRetryIntervalRef.current) {
            clearInterval(offerRetryIntervalRef.current);
            offerRetryIntervalRef.current = null;
          }
          console.log("[WebRTC Viewer] ⚠️ Max retries reached, waiting for realtime subscription...");
        }
      }, 2000);
    };

    try {
      // 이전 시그널링 메시지 정리 — await 필수! viewer-join이 삭제되는 레이스 컨디션 방지
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer");
      console.log("[WebRTC Viewer] Old signaling cleaned");

      // PeerConnection 생성
      peerConnectionRef.current = createPeerConnection();

      // viewer-join 메시지 전송 (broadcaster에게 알림)
      await sendSignalingMessage("viewer-join", { 
        viewerId: sessionIdRef.current,
      });

      // Realtime으로 broadcaster의 응답 구독
      // 항상 새 채널 생성 - 기존 채널 재사용 시 stale handler 문제 방지
      const channelName = `webrtc-signaling-viewer-${deviceId}-${Date.now()}`;
      
      // 기존 동일 디바이스 채널 제거
      const existingChannels = supabase.getChannels();
      existingChannels.forEach(ch => {
        if (ch.topic.includes(`webrtc-signaling-viewer-${deviceId}`)) {
          console.log("[WebRTC Viewer] Removing stale channel:", ch.topic);
          supabase.removeChannel(ch);
        }
      });
      
      console.log("[WebRTC Viewer] Creating new signaling channel:", channelName);
      
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
            if (record.sender_type === "broadcaster") {
              console.log("[WebRTC Viewer] ✅ Received:", record.type, "from broadcaster");
              handleSignalingMessage(record);
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.error("[WebRTC Viewer] Channel error");
          } else if (status === "SUBSCRIBED") {
            console.log("[WebRTC Viewer] Channel subscribed, checking for existing offer...");
            checkForExistingOffer();
          }
        });

      channelRef.current = channel;

      // 초기 offer 체크 후 없으면 재시도 시작
      const initialOfferFound = await checkForExistingOffer();
      if (!initialOfferFound) {
        startOfferRetry();
      }

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
