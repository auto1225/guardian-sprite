import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface WebRTCBroadcasterOptions {
  deviceId: string;
  onError?: (error: string) => void;
  onViewerConnected?: (viewerId: string) => void;
  onViewerDisconnected?: (viewerId: string) => void;
}

interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  from: string;
  to: string;
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

  const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
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

    setLocalStream(null);
    setIsBroadcasting(false);
    setViewerCount(0);
  }, [onViewerDisconnected]);

  const sendSignalingMessage = useCallback(
    async (message: Omit<SignalingMessage, "from">) => {
      if (!channelRef.current) return;

      await channelRef.current.send({
        type: "broadcast",
        event: "signaling",
        payload: {
          ...message,
          from: deviceId,
        },
      });
    },
    [deviceId]
  );

  const createPeerConnectionForViewer = useCallback(
    (viewerId: string) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add local stream tracks to the connection
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: "ice-candidate",
            payload: event.candidate.toJSON(),
            to: viewerId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${viewerId}:`, pc.connectionState);
        if (
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
        console.log(`ICE state with ${viewerId}:`, pc.iceConnectionState);
      };

      return pc;
    },
    [sendSignalingMessage, onViewerDisconnected]
  );

  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      console.log("Viewer joined:", viewerId);

      // Create peer connection for this viewer
      const pc = createPeerConnectionForViewer(viewerId);
      viewerConnectionsRef.current.set(viewerId, { pc, viewerId });
      setViewerCount(viewerConnectionsRef.current.size);

      try {
        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await sendSignalingMessage({
          type: "offer",
          payload: offer,
          to: viewerId,
        });

        onViewerConnected?.(viewerId);
      } catch (error) {
        console.error("Error creating offer for viewer:", error);
        pc.close();
        viewerConnectionsRef.current.delete(viewerId);
        setViewerCount(viewerConnectionsRef.current.size);
      }
    },
    [createPeerConnectionForViewer, sendSignalingMessage, onViewerConnected]
  );

  const handleSignalingMessage = useCallback(
    async (message: SignalingMessage) => {
      // Only process messages meant for this broadcaster
      if (message.to !== deviceId) return;

      const viewerConnection = viewerConnectionsRef.current.get(message.from);
      if (!viewerConnection) {
        console.warn("Received message from unknown viewer:", message.from);
        return;
      }

      const { pc } = viewerConnection;

      try {
        if (message.type === "answer") {
          console.log("Received answer from viewer:", message.from);
          await pc.setRemoteDescription(
            new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
          );
        } else if (message.type === "ice-candidate") {
          console.log("Received ICE candidate from viewer:", message.from);
          await pc.addIceCandidate(
            new RTCIceCandidate(message.payload as RTCIceCandidateInit)
          );
        }
      } catch (error) {
        console.error("Error handling signaling message:", error);
      }
    },
    [deviceId]
  );

  const startBroadcasting = useCallback(async () => {
    if (isBroadcasting) return;

    try {
      // Get local camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      // Subscribe to signaling channel
      const channel = supabase.channel(`webrtc-${deviceId}`);
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "signaling" }, ({ payload }) => {
          handleSignalingMessage(payload as SignalingMessage);
        })
        .on("broadcast", { event: "viewer-join" }, ({ payload }) => {
          const { viewerId } = payload as { viewerId: string };
          handleViewerJoin(viewerId);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("Broadcaster connected to signaling channel");
            setIsBroadcasting(true);
          }
        });
    } catch (error) {
      console.error("Error starting broadcast:", error);
      cleanup();
      onError?.("카메라 접근에 실패했습니다. 권한을 확인해주세요.");
    }
  }, [deviceId, isBroadcasting, cleanup, handleSignalingMessage, handleViewerJoin, onError]);

  const stopBroadcasting = useCallback(() => {
    cleanup();
  }, [cleanup]);

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
