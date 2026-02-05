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
          handleSignalingMessage(payload as SignalingMessage);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            console.log("Connected to signaling channel, requesting stream...");
            
            // Request stream from broadcaster
            await channel.send({
              type: "broadcast",
              event: "viewer-join",
              payload: {
                viewerId: viewerIdRef.current,
              },
            });
          }
        });

      // Timeout if no connection after 15 seconds
      setTimeout(() => {
        if (!isConnected && isConnecting) {
          cleanup();
          onError?.("연결 시간이 초과되었습니다. 노트북 카메라가 활성화되어 있는지 확인하세요.");
        }
      }, 15000);

    } catch (error) {
      console.error("Error connecting:", error);
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
