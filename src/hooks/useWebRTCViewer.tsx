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
  const isConnectedRef = useRef(false);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const hasRemoteDescriptionRef = useRef(false);
  const hasSentAnswerRef = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const offerRetryCountRef = useRef(0);
  const offerRetryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastViewerJoinSentRef = useRef<number>(0);
  const isProcessingOfferRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectionSucceededAtRef = useRef<number>(0);
  // ★ NEW: 지속적 offer 폴링 (브로드캐스터 벤치마킹)
  const offerPollingRef = useRef<NodeJS.Timeout | null>(null);

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

  const cleanup = useCallback((preserveStream = false) => {
    console.log("[WebRTC Viewer] Cleaning up... preserveStream:", preserveStream);
    
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (offerRetryIntervalRef.current) {
      clearInterval(offerRetryIntervalRef.current);
      offerRetryIntervalRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // ★ NEW: offer 폴링 정리
    if (offerPollingRef.current) {
      clearInterval(offerPollingRef.current);
      offerPollingRef.current = null;
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
    console.log("[WebRTC Viewer] ✅ PC created");

    // ★ 핵심 변경: event.streams[0]을 직접 사용
    // 브로드캐스터가 addTrack(track, stream)으로 동일 스트림에 오디오/비디오를 추가하므로
    // event.streams[0]은 브라우저가 관리하는 원본 스트림 — RTP 라우팅이 정확히 동작함
    // 수동 new MediaStream(tracks)은 브라우저 내부 바인딩을 깨뜨려 비디오 RTP가 누락됨
    let streamSet = false;
    
    pc.ontrack = (event) => {
      console.log("[WebRTC Viewer] ✅ Track received:", event.track.kind,
        "readyState:", event.track.readyState, "muted:", event.track.muted,
        "streams:", event.streams?.length || 0);
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        console.log("[WebRTC Viewer] 📹 Browser-managed stream, tracks:", 
          stream.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`).join(", "));
        
        // ★ 같은 스트림 객체가 오므로 최초 1회만 setRemoteStream 호출
        // 두 번째 ontrack에서는 같은 스트림에 트랙이 이미 추가되어 있음
        // video element는 srcObject의 트랙 변경을 자동 감지
        if (!streamSet) {
          streamSet = true;
          setRemoteStream(stream);
          console.log("[WebRTC Viewer] 📹 remoteStream set (first time)");
        } else {
          // ★ 두 번째 트랙 추가 시: React 리렌더를 위해 새 참조 생성하지 않음
          // 대신 video element가 스트림 내 트랙 변경을 자동 감지함
          // 하지만 CameraViewer의 useEffect가 trackIds 변경을 감지하도록 강제 업데이트
          setRemoteStream(prev => {
            if (prev === stream) {
              // 같은 참조이므로 React가 리렌더하지 않음 → 강제로 새 MediaStream 래핑
              const wrapped = new MediaStream(stream.getTracks());
              console.log("[WebRTC Viewer] 📹 Wrapping stream for React update, tracks:", 
                wrapped.getTracks().map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`).join(", "));
              return wrapped;
            }
            return stream;
          });
        }
      } else {
        // Fallback: event.streams가 없는 경우
        console.log("[WebRTC Viewer] ⚠️ No streams in event, creating manual stream");
        setRemoteStream(prev => {
          const s = prev || new MediaStream();
          if (!s.getTracks().find(t => t.id === event.track.id)) {
            s.addTrack(event.track);
          }
          return new MediaStream(s.getTracks());
        });
      }
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (offerPollingRef.current) {
        clearInterval(offerPollingRef.current);
        offerPollingRef.current = null;
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
        
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        if (offerPollingRef.current) {
          clearInterval(offerPollingRef.current);
          offerPollingRef.current = null;
        }
        
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;
        connectionSucceededAtRef.current = Date.now();
        setIsConnected(true);
        setIsConnecting(false);
      } else if (pc.connectionState === "disconnected") {
        console.log("[WebRTC Viewer] ⚠️ Connection disconnected, waiting 10s for recovery...");
        isConnectedRef.current = false;
        isConnectingRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        setTimeout(() => {
          if (peerConnectionRef.current?.connectionState === "disconnected") {
            console.log("[WebRTC Viewer] Connection did not recover after 10s, reconnecting...");
            cleanup(true);
            scheduleReconnect();
          }
        }, 10000);
      } else if (pc.connectionState === "failed") {
        console.log("[WebRTC Viewer] ❌ Connection failed, reconnecting...");
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

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    const MAX_RECONNECT = 3;
    const attempt = reconnectAttemptRef.current;
    
    if (attempt >= MAX_RECONNECT) {
      console.log("[WebRTC Viewer] Max reconnect attempts reached");
      onError?.(i18n.t("camera.disconnected"));
      return;
    }

    if (Date.now() - connectionSucceededAtRef.current < 5000) {
      console.log("[WebRTC Viewer] ⏭️ Skipping reconnect (connected recently)");
      return;
    }

    const delay = attempt === 0 ? 0 : Math.pow(2, attempt) * 1000;
    console.log(`[WebRTC Viewer] 🔄 Reconnect attempt ${attempt + 1}/${MAX_RECONNECT} in ${delay}ms`);
    
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      if (!isConnectedRef.current && !isConnectingRef.current) {
        connectRef.current();
      }
    }, delay);
  }, [onError]);

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

  const handleSignalingMessage = useCallback(async (record: SignalingRecord) => {
    if (processedMessagesRef.current.has(record.id)) return;
    processedMessagesRef.current.add(record.id);

    const pc = peerConnectionRef.current;
    if (!pc) {
      console.warn("[WebRTC Viewer] No peer connection for message:", record.type);
      return;
    }

    try {
      if (record.type === "offer") {
        const targetSession = (record.data as Record<string, unknown>).target_session as string | undefined;
        if (targetSession && targetSession !== sessionIdRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Ignoring offer for different session:", targetSession, "my:", sessionIdRef.current);
          return;
        }
        
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
        
        isProcessingOfferRef.current = true;
        console.log("[WebRTC Viewer] ✅ Processing offer, SDP extraction...");
        
        let sdp: string | undefined;
        if (typeof record.data.sdp === 'string') {
          sdp = record.data.sdp;
        } else if (record.data.sdp && typeof record.data.sdp === 'object' && 'sdp' in record.data.sdp) {
          sdp = (record.data.sdp as { sdp: string }).sdp;
        }
        
        if (!sdp || typeof sdp !== 'string') {
          console.error("[WebRTC Viewer] ❌ Invalid SDP format:", typeof record.data.sdp);
          isProcessingOfferRef.current = false;
          onError?.(i18n.t("camera.invalidSdp"));
          return;
        }

        console.log("[WebRTC Viewer] Setting remote description, SDP length:", sdp.length);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
        
        hasRemoteDescriptionRef.current = true;
        console.log("[WebRTC Viewer] ✅ Remote description set");
        
        await processPendingIceCandidates();
        
        if (!hasSentAnswerRef.current) {
          hasSentAnswerRef.current = true;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          console.log("[WebRTC Viewer] Sending answer...");
          await sendSignalingMessage("answer", { 
            type: "answer", 
            sdp: answer.sdp,
            target_session: sessionIdRef.current,
          });
          console.log("[WebRTC Viewer] ✅ Answer sent");
          
          // ★ NEW: offer 폴링 중지 — SDP 교환 완료
          if (offerPollingRef.current) {
            clearInterval(offerPollingRef.current);
            offerPollingRef.current = null;
          }
          // ★ offer 재시도도 중지
          if (offerRetryIntervalRef.current) {
            clearInterval(offerRetryIntervalRef.current);
            offerRetryIntervalRef.current = null;
          }
          
          isProcessingOfferRef.current = false;
        } else {
          console.log("[WebRTC Viewer] ⏭️ Answer already sent");
          isProcessingOfferRef.current = false;
        }
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        const iceTargetSession = (record.data as Record<string, unknown>).target_session as string | undefined;
        if (iceTargetSession && iceTargetSession !== sessionIdRef.current) {
          console.log("[WebRTC Viewer] ⏭️ Ignoring ICE for different session");
          return;
        }
        
        if (!hasRemoteDescriptionRef.current) {
          console.log("[WebRTC Viewer] Buffering ICE candidate");
          pendingIceCandidatesRef.current.push(record.data.candidate);
        } else {
          console.log("[WebRTC Viewer] Adding ICE candidate");
          await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
        }
      }
    } catch (error) {
      console.error("[WebRTC Viewer] Error handling signaling:", error);
      isProcessingOfferRef.current = false;
      onError?.(i18n.t("camera.signalingError"));
    }
  }, [sendSignalingMessage, onError, processPendingIceCandidates]);

  // ★ NEW: PC를 리셋하고 viewer-join을 재전송하는 헬퍼 (broadcaster-ready 대응)
  const resetAndRejoin = useCallback((reason: string) => {
    console.log(`[WebRTC Viewer] 🔄 resetAndRejoin (${reason})`);
    
    // 기존 PC 완전 정리
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // 상태 초기화
    processedMessagesRef.current.clear();
    pendingIceCandidatesRef.current = [];
    hasRemoteDescriptionRef.current = false;
    hasSentAnswerRef.current = false;
    isProcessingOfferRef.current = false;
    
    // ★ 새 세션 ID 생성 — stale 시그널링 충돌 방지 (브로드캐스터 벤치마킹)
    sessionIdRef.current = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log("[WebRTC Viewer] 🆕 New session ID:", sessionIdRef.current);
    
    isConnectedRef.current = false;
    isConnectingRef.current = true;
    setIsConnected(false);
    setIsConnecting(true);
    setRemoteStream(null);
    
    // 새 PC 생성 + viewer-join 재전송
    peerConnectionRef.current = createPeerConnection();
    
    // ★ 1초 딜레이 후 viewer-join (브로드캐스터의 이전 세션 정리 시간 확보)
    setTimeout(() => {
      sendSignalingMessage("viewer-join", { 
        viewerId: sessionIdRef.current,
        reason,
      });
      lastViewerJoinSentRef.current = Date.now();
    }, 1000);
  }, [createPeerConnection, sendSignalingMessage]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current || isConnectedRef.current) {
      console.log("[WebRTC Viewer] Already connecting or connected, skipping...");
      return;
    }
    
    isConnectingRef.current = true;
    console.log("[WebRTC Viewer] Starting connection...");
    setIsConnecting(true);
    
    // 기존 PeerConnection 정리
    if (peerConnectionRef.current) {
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
    if (offerPollingRef.current) {
      clearInterval(offerPollingRef.current);
      offerPollingRef.current = null;
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

    // 기존 offer 확인 함수
    const checkForExistingOffer = async (): Promise<boolean> => {
      // ★ 이미 offer를 받았으면 불필요
      if (hasRemoteDescriptionRef.current || hasSentAnswerRef.current) return true;
      
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
      }
      return false;
    };

    // ★ NEW: 지속적 offer 폴링 (브로드캐스터의 3초 폴링 벤치마킹)
    // Realtime이 누락할 수 있으므로 3초 간격으로 offer + ICE candidate 폴링
    const startOfferPolling = () => {
      offerPollingRef.current = setInterval(async () => {
        // 연결 완료 시 중지
        if (isConnectedRef.current || !isConnectingRef.current) {
          if (offerPollingRef.current) {
            clearInterval(offerPollingRef.current);
            offerPollingRef.current = null;
          }
          return;
        }
        
        console.log("[WebRTC Viewer] 🔄 Polling for signaling messages...");
        
        // offer가 아직 없으면 체크
        if (!hasRemoteDescriptionRef.current) {
          await checkForExistingOffer();
        }
        
        // ★ ICE candidate도 폴링 (Realtime 누락 대비)
        if (hasRemoteDescriptionRef.current && peerConnectionRef.current) {
          const { data: iceCandidates } = await supabase
            .from("webrtc_signaling")
            .select("*")
            .eq("device_id", deviceId)
            .eq("sender_type", "broadcaster")
            .eq("type", "ice-candidate")
            .order("created_at", { ascending: true });
          
          if (iceCandidates) {
            for (const record of iceCandidates) {
              if (!processedMessagesRef.current.has(record.id)) {
                handleSignalingMessage(record as SignalingRecord);
              }
            }
          }
        }
      }, 3000);
    };

    // Offer 재요청 로직 - 2초마다 최대 5회 viewer-join 재전송
    const startOfferRetry = () => {
      offerRetryCountRef.current = 0;
      offerRetryIntervalRef.current = setInterval(async () => {
        if (hasRemoteDescriptionRef.current || isConnectedRef.current || !isConnectingRef.current) {
          if (offerRetryIntervalRef.current) {
            clearInterval(offerRetryIntervalRef.current);
            offerRetryIntervalRef.current = null;
          }
          return;
        }
        
        offerRetryCountRef.current++;
        console.log(`[WebRTC Viewer] 🔄 Retry ${offerRetryCountRef.current}/5: viewer-join...`);
        
        const foundOffer = await checkForExistingOffer();
        
        if (!foundOffer && offerRetryCountRef.current <= 5) {
          await sendSignalingMessage("viewer-join", { 
            viewerId: sessionIdRef.current,
            retry: offerRetryCountRef.current,
          });
        }
        
        if (offerRetryCountRef.current >= 5) {
          if (offerRetryIntervalRef.current) {
            clearInterval(offerRetryIntervalRef.current);
            offerRetryIntervalRef.current = null;
          }
          console.log("[WebRTC Viewer] ⚠️ Max retries, relying on polling + realtime...");
        }
      }, 2000);
    };

    try {
      // 이전 시그널링 메시지 정리
      await supabase
        .from("webrtc_signaling")
        .delete()
        .eq("device_id", deviceId)
        .eq("sender_type", "viewer");
      console.log("[WebRTC Viewer] Old signaling cleaned");

      // PeerConnection 생성
      peerConnectionRef.current = createPeerConnection();

      // viewer-join 전송
      lastViewerJoinSentRef.current = Date.now();
      await sendSignalingMessage("viewer-join", { 
        viewerId: sessionIdRef.current,
      });

      // Realtime 구독
      const channelName = `webrtc-signaling-viewer-${deviceId}-${Date.now()}`;
      
      const existingChannels = supabase.getChannels();
      existingChannels.forEach(ch => {
        if (ch.topic.includes(`webrtc-signaling-viewer-${deviceId}`)) {
          supabase.removeChannel(ch);
        }
      });
      
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
              // ★ FIX: broadcaster-ready 처리 — 초기 연결 중에도 처리
              if (record.type === "broadcaster-ready") {
                console.log("[WebRTC Viewer] 📡 broadcaster-ready received!",
                  "connecting:", isConnectingRef.current,
                  "connected:", isConnectedRef.current);
                
                // ★ 디바운스: 마지막 viewer-join 전송 후 2초 이내이면 무시
                // (viewer-join → broadcaster가 offer 생성 중인데 또 viewer-join을 보내면 중복)
                const sinceLastJoin = Date.now() - lastViewerJoinSentRef.current;
                if (sinceLastJoin < 2000) {
                  console.log("[WebRTC Viewer] ⏭️ Ignoring broadcaster-ready (viewer-join sent recently:", sinceLastJoin, "ms ago)");
                  return;
                }
                
                // ★ 이미 offer를 처리했으면 무시 (정상 핸드셰이크 진행 중)
                if (hasRemoteDescriptionRef.current || hasSentAnswerRef.current) {
                  console.log("[WebRTC Viewer] ⏭️ Ignoring broadcaster-ready (SDP exchange already done)");
                  return;
                }
                
                // ★ broadcaster가 (재)시작됨 → PC 리셋 + 새 세션으로 viewer-join 재전송
                resetAndRejoin("broadcaster-ready");
                return;
              }
              
              console.log("[WebRTC Viewer] ✅ Received:", record.type, "from broadcaster");
              handleSignalingMessage(record);
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.error("[WebRTC Viewer] ❌ Channel error");
          } else if (status === "SUBSCRIBED") {
            console.log("[WebRTC Viewer] ✅ Channel subscribed");
            checkForExistingOffer();
          }
        });

      channelRef.current = channel;

      // 초기 offer 체크 + 재시도 시작
      const initialOfferFound = await checkForExistingOffer();
      if (!initialOfferFound) {
        startOfferRetry();
      }

      // ★ 폴링 시작 (2초 유예 후)
      setTimeout(() => {
        if (isConnectingRef.current && !isConnectedRef.current && !hasRemoteDescriptionRef.current) {
          console.log("[WebRTC Viewer] Starting continuous offer polling...");
          startOfferPolling();
        }
      }, 2000);

      // 30초 타임아웃
      connectionTimeoutRef.current = setTimeout(() => {
        if (isConnectingRef.current && !isConnectedRef.current) {
          console.log("[WebRTC Viewer] ⏰ Connection timeout");
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
  }, [deviceId, cleanup, createPeerConnection, sendSignalingMessage, handleSignalingMessage, onError, resetAndRejoin]);

  connectRef.current = connect;

  const disconnect = useCallback(async () => {
    console.log("[WebRTC Viewer] Disconnecting...");
    isConnectingRef.current = false;
    cleanup(false);
    
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
