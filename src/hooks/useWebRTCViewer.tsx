import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface WebRTCViewerOptions {
  deviceId: string;
  onError?: (error: string) => void;
}

interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  from: string;
  to: string;
}

export const useWebRTCViewer = ({ deviceId, onError }: WebRTCViewerOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const viewerIdRef = useRef<string>(`viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const sendSignalingMessage = useCallback(async (message: Omit<SignalingMessage, "from">) => {
    if (!channelRef.current) return;
    
    await channelRef.current.send({
      type: "broadcast",
      event: "signaling",
      payload: {
        ...message,
        from: viewerIdRef.current,
      },
    });
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setIsConnected(true);
        setIsConnecting(false);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage({
          type: "ice-candidate",
          payload: event.candidate.toJSON(),
          to: deviceId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanup();
        onError?.("연결이 끊어졌습니다");
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    return pc;
  }, [deviceId, sendSignalingMessage, cleanup, onError]);

  const handleSignalingMessage = useCallback(async (message: SignalingMessage) => {
    // Only process messages meant for this viewer
    if (message.to !== viewerIdRef.current && message.to !== "all") return;
    
    const pc = peerConnectionRef.current;
    if (!pc) return;

    try {
      if (message.type === "offer") {
        console.log("Received offer from broadcaster");
        await pc.setRemoteDescription(new RTCSessionDescription(message.payload as RTCSessionDescriptionInit));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        await sendSignalingMessage({
          type: "answer",
          payload: answer,
          to: message.from,
        });
      } else if (message.type === "ice-candidate") {
        console.log("Received ICE candidate");
        await pc.addIceCandidate(new RTCIceCandidate(message.payload as RTCIceCandidateInit));
      }
    } catch (error) {
      console.error("Error handling signaling message:", error);
      onError?.("시그널링 오류가 발생했습니다");
    }
  }, [sendSignalingMessage, onError]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;
    
    setIsConnecting(true);
    cleanup();

    try {
      // Create peer connection
      peerConnectionRef.current = createPeerConnection();

      // Subscribe to signaling channel
      const channel = supabase.channel(`webrtc-${deviceId}`);
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "signaling" }, ({ payload }) => {
          console.log("[WebRTC Viewer] Received signaling message:", (payload as SignalingMessage).type);
          handleSignalingMessage(payload as SignalingMessage);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            console.log("[WebRTC Viewer] Connected to signaling channel");
            
            // 노트북이 브로드캐스팅 준비될 때까지 잠시 대기 후 viewer-join 전송
            // 여러 번 재시도하여 타이밍 문제 해결
            const sendJoinRequest = async (attempt: number = 1) => {
              if (attempt > 5) return; // 최대 5번 시도
              
              console.log(`[WebRTC Viewer] Sending viewer-join (attempt ${attempt})`);
              await channel.send({
                type: "broadcast",
                event: "viewer-join",
                payload: {
                  viewerId: viewerIdRef.current,
                },
              });
              
              // 2초 후에도 연결 안되면 재시도
              setTimeout(() => {
                if (!peerConnectionRef.current?.remoteDescription) {
                  console.log("[WebRTC Viewer] No offer received, retrying...");
                  sendJoinRequest(attempt + 1);
                }
              }, 2000);
            };
            
            // 500ms 후 첫 요청 (노트북이 채널 구독할 시간 확보)
            setTimeout(() => sendJoinRequest(1), 500);
          }
        });

      // Timeout if no connection after 30 seconds
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
  }, [deviceId, isConnecting, isConnected, cleanup, createPeerConnection, handleSignalingMessage, onError]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

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
