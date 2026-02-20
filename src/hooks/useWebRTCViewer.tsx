import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";

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
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null); // ontrack debounce
  const offerRetryCountRef = useRef(0); // Track offer retry count
  const offerRetryIntervalRef = useRef<NodeJS.Timeout | null>(null); // Retry interval
  const lastViewerJoinSentRef = useRef<number>(0); // broadcaster-ready 디바운스용
  const isProcessingOfferRef = useRef(false); // ★ offer 중복 처리 방지
  const reconnectAttemptRef = useRef(0); // S-12: 자동 재연결 시도 횟수
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null); // S-12: 재연결 타이머
  const connectionSucceededAtRef = useRef<number>(0); // 연결 성공 직후 재연결 차단

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 10,
  };

  // preserveStream=true: 연결 해제 시 마지막 프레임 유지 (disconnect overlay 표시용)
  const cleanup = useCallback((preserveStream = false) => {
    console.log("[WebRTC Viewer] Cleaning up... isConnecting:", isConnectingRef.current, "preserveStream:", preserveStream);
    
    // Clear timeouts
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Clear retry interval
    if (offerRetryIntervalRef.current) {
      clearInterval(offerRetryIntervalRef.current);
      offerRetryIntervalRef.current = null;
    }

    // S-12: Clear reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
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
    isProcessingOfferRef.current = false;
    isConnectingRef.current = false;
    isConnectedRef.current = false;
    if (!preserveStream) {
      setRemoteStream(null);
    }
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
    const pc = new RTCPeerConnection({
      ...ICE_SERVERS,
      bundlePolicy: "max-bundle",
    });

    // ★ ontrack: 항상 PC receivers에서 새 MediaStream 생성 (stale stream 방지)
    let pendingStreamUpdate: NodeJS.Timeout | null = null;
    let receivedTrackKinds = new Set<string>();

    pc.ontrack = (event) => {
      console.log("[WebRTC Viewer] ✅ Received remote track:", event.track.kind, "readyState:", event.track.readyState, "muted:", event.track.muted);
      
      const track = event.track;
      receivedTrackKinds.add(track.kind);

      const commitStream = () => {
        // ★ 항상 PC receivers에서 새 MediaStream 생성 — stale event.streams[0] 문제 회피
        const currentPc = peerConnectionRef.current;
        if (!currentPc) return;
        const allTracks: MediaStreamTrack[] = [];
        currentPc.getReceivers().forEach(r => {
          // ★ readyState 필터 완화: "ended"가 아니면 모두 포함 (오디오 트랙이 muted 상태에서도 포함되도록)
          if (r.track && r.track.readyState !== "ended") {
            allTracks.push(r.track);
          }
        });
        if (allTracks.length === 0) {
          console.warn("[WebRTC Viewer] ⚠️ No tracks from receivers, skipping commit");
          return;
        }

        // ★ 기존 스트림과 트랙이 동일하면 재설정하지 않음 (무한 리마운트 방지)
        setRemoteStream(prev => {
          if (prev) {
            const prevIds = prev.getTracks().map(t => t.id).sort().join(",");
            const newIds = allTracks.map(t => t.id).sort().join(",");
            if (prevIds === newIds) {
              console.log("[WebRTC Viewer] ⏭️ Same tracks, skipping stream update");
              return prev;
            }
          }
          const freshStream = new MediaStream(allTracks);
          console.log("[WebRTC Viewer] 📹 Committing fresh stream with", freshStream.getTracks().length, "tracks",
            freshStream.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`).join(", "));
          return freshStream;
        });

        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        setIsConnected(true);
        setIsConnecting(false);
      };

      const scheduleUpdate = () => {
        if (pendingStreamUpdate) clearTimeout(pendingStreamUpdate);
        // ★ 디바운스를 500ms로 늘려 오디오+비디오 트랙이 모두 도착할 시간 확보
        pendingStreamUpdate = setTimeout(() => {
          commitStream();
        }, 500);
      };

      if (track.muted) {
        console.log(`[WebRTC Viewer] ⏳ ${track.kind} track is muted, waiting for unmute...`);
        const onUnmute = () => {
          console.log(`[WebRTC Viewer] ✅ ${track.kind} track unmuted, triggering stream update`);
          track.removeEventListener("unmute", onUnmute);
          scheduleUpdate();
        };
        track.addEventListener("unmute", onUnmute);
        // ★ muted 트랙도 일정 시간 후 강제 커밋 (unmute 이벤트가 오지 않는 경우 대비)
        setTimeout(() => {
          if (track.readyState !== "ended") {
            console.log(`[WebRTC Viewer] ⏰ Force commit after timeout for ${track.kind} track (muted=${track.muted})`);
            track.removeEventListener("unmute", onUnmute);
            scheduleUpdate();
          }
        }, 2000);
      } else {
        scheduleUpdate();
      }
      
      track.onended = () => console.log("[WebRTC Viewer] ⚠️ Track ended:", track.kind);
      track.onmute = () => console.log("[WebRTC Viewer] ⚠️ Track muted:", track.kind);
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
        
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0; // S-12: 성공 시 재연결 카운터 리셋
        connectionSucceededAtRef.current = Date.now();
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === "disconnected") {
        console.log("[WebRTC Viewer] ⚠️ Connection disconnected, preserving last frame...");
        isConnectedRef.current = false;
        isConnectingRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        // 10초 후에도 복구되지 않으면 자동 재연결 시도
        setTimeout(() => {
          if (peerConnectionRef.current?.connectionState === "disconnected") {
            console.log("[WebRTC Viewer] Connection did not recover after 10s, attempting reconnect...");
            cleanup(true);
            scheduleReconnect();
          }
        }, 10000);
      } else if (pc.connectionState === "failed") {
        console.log("[WebRTC Viewer] Connection failed, attempting reconnect...");
        isConnectingRef.current = false;
        isConnectedRef.current = false;
        cleanup(true);
        scheduleReconnect();
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC Viewer] ICE state:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        console.log("[WebRTC Viewer] ❌ ICE connection failed");
      } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        console.log("[WebRTC Viewer] ✅ ICE connection established");
      }
    };

    return pc;
  }, [sendSignalingMessage, cleanup, onError]);

  // S-12: 자동 재연결 (지수 백오프: 즉시→2초→4초, 최대 3회)
  // connect는 아래에서 정의되므로 connectRef를 사용하여 stale closure 방지
  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    const MAX_RECONNECT = 3;
    const attempt = reconnectAttemptRef.current;
    
    if (attempt >= MAX_RECONNECT) {
      console.log("[WebRTC Viewer] Max reconnect attempts reached");
      onError?.(i18n.t("camera.disconnected"));
      return;
    }

    // 연결 성공 직후 5초 이내이면 재연결 차단
    if (Date.now() - connectionSucceededAtRef.current < 5000) {
      console.log("[WebRTC Viewer] ⏭️ Skipping reconnect (connected recently)");
      return;
    }

    const delay = attempt === 0 ? 0 : Math.pow(2, attempt) * 1000; // 0, 2s, 4s
    console.log(`[WebRTC Viewer] 🔄 Scheduling reconnect attempt ${attempt + 1}/${MAX_RECONNECT} in ${delay}ms`);
    
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      if (!isConnectedRef.current && !isConnectingRef.current) {
        connectRef.current();
      }
    }, delay);
  }, [onError]);

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
        
        // ★ 이미 offer를 처리 중이거나 완료된 경우 스킵
        if (isProcessingOfferRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Skipping offer (already processing)");
          return;
        }
        if (hasSentAnswerRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Skipping duplicate offer (already sent answer)");
          return;
        }
        if (hasRemoteDescriptionRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Skipping duplicate offer (already have remote description)");
          return;
        }
        
        // ★ 즉시 플래그 설정 — 비동기 작업 전에 잠금
        isProcessingOfferRef.current = true;
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
          onError?.(i18n.t("camera.invalidSdp"));
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
            target_session: sessionIdRef.current,
          });
          // ★ offer 처리 완료 후 플래그 리셋 — 후속 offer 수신 가능
          isProcessingOfferRef.current = false;
        } else {
          console.log("[WebRTC Viewer] ⏭️ Answer already sent, skipping...");
          isProcessingOfferRef.current = false;
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
      onError?.(i18n.t("camera.signalingError"));
    }
  }, [sendSignalingMessage, onError, processPendingIceCandidates]);

  const connect = useCallback(async () => {
    // Use ref for synchronous check to prevent race conditions
    if (isConnectingRef.current || isConnectedRef.current) {
      console.log("[WebRTC Viewer] Already connecting or connected, skipping...");
      return;
    }
    
    isConnectingRef.current = true;
    console.log("[WebRTC Viewer] Starting connection...");
    setIsConnecting(true);
    
    // ★ 기존 PeerConnection을 동기적으로 완전히 정리 (좀비 세션 방지)
    if (peerConnectionRef.current) {
      console.log("[WebRTC Viewer] Closing previous PeerConnection before new connect");
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    
    // 모든 ref 상태 초기화
    processedMessagesRef.current.clear();
    pendingIceCandidatesRef.current = [];
    hasRemoteDescriptionRef.current = false;
    hasSentAnswerRef.current = false;
    isProcessingOfferRef.current = false;
    offerRetryCountRef.current = 0;
    if (offerRetryIntervalRef.current) {
      clearInterval(offerRetryIntervalRef.current);
      offerRetryIntervalRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setRemoteStream(null);

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
      lastViewerJoinSentRef.current = Date.now();
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
              // broadcaster-ready 시그널 감지 → 자동 재연결
              if (record.type === "broadcaster-ready") {
                // 초기 연결 시도 중(isConnecting)에는 완전히 무시
                if (isConnectingRef.current && !isConnectedRef.current) {
                  console.log("[WebRTC Viewer] ⏭️ Ignoring broadcaster-ready (initial connection in progress)");
                  return;
                }
                
                // 이미 연결된 상태에서 broadcaster-ready가 오면 연결이 끊겼음을 의미하므로 재연결
                console.log("[WebRTC Viewer] 📡 Broadcaster ready signal received! Resetting PC and re-joining...");
                
                // Clean up previous PC
                if (peerConnectionRef.current) {
                  peerConnectionRef.current.close();
                  peerConnectionRef.current = null;
                }
                
                // Reset states for re-connection
                processedMessagesRef.current.clear();
                pendingIceCandidatesRef.current = [];
                hasRemoteDescriptionRef.current = false;
                hasSentAnswerRef.current = false;
                
                isConnectedRef.current = false;
                isConnectingRef.current = true;
                setIsConnected(false);
                setIsConnecting(true);
                setRemoteStream(null);
                
                // Create new PC and send join message to trigger new offer
                peerConnectionRef.current = createPeerConnection();
                sendSignalingMessage("viewer-join", { 
                  viewerId: sessionIdRef.current,
                  reason: "broadcaster-ready"
                });
                return;
              }
              
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
          onError?.(i18n.t("camera.connectionTimeout"));
        }
      }, 30000);

    } catch (error) {
      console.error("[WebRTC Viewer] Error connecting:", error);
      isConnectingRef.current = false;
      cleanup();
      onError?.(i18n.t("camera.connectionError2"));
    }
  }, [deviceId, cleanup, createPeerConnection, sendSignalingMessage, handleSignalingMessage, onError]);

  // connectRef를 최신 connect로 동기화 (scheduleReconnect에서 사용)
  connectRef.current = connect;

  const disconnect = useCallback(async () => {
    console.log("[WebRTC Viewer] Disconnecting..., wasConnecting:", isConnectingRef.current);
    isConnectingRef.current = false;
    
    // 완전 정리 (스트림 포함)
    cleanup(false);
    
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
