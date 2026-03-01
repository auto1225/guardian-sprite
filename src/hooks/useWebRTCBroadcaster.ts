import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ICE_SERVERS } from "@/lib/webrtc/config";
import {
  SignalingRecord,
  sendSignaling,
  cleanSignaling,
  fetchViewerJoins,
  extractSdp,
  createSessionId,
} from "@/lib/webrtc/signaling";
import type { WebRTCBroadcasterOptions } from "@/lib/webrtc/types";

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

  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processedRef = useRef(new Set<string>());
  const processedJoinsRef = useRef(new Set<string>());
  const sessionIdRef = useRef(createSessionId("broadcaster"));
  const isRecoveringRef = useRef(false);
  const trackEndedCleanupRef = useRef<Array<() => void>>([]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const sendMsg = useCallback(
    (type: string, data: Record<string, unknown>, targetSession?: string) =>
      sendSignaling(deviceId, sessionIdRef.current, "broadcaster", type, {
        ...data,
        target_session: targetSession,
      }),
    [deviceId],
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    // Clean up track-ended listeners
    trackEndedCleanupRef.current.forEach(fn => fn());
    trackEndedCleanupRef.current = [];

    viewersRef.current.forEach(({ pc, viewerId }) => {
      pc.close();
      onViewerDisconnected?.(viewerId);
    });
    viewersRef.current.clear();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    processedRef.current.clear();
    processedJoinsRef.current.clear();
    isRecoveringRef.current = false;
    setLocalStream(null);
    setIsBroadcasting(false);
    setViewerCount(0);
  }, [onViewerDisconnected]);

  // ── Re-acquire stream and replace tracks on all PCs ─────────────────────
  const recoverStream = useCallback(async () => {
    if (isRecoveringRef.current) return;
    isRecoveringRef.current = true;
    console.log("[WebRTC Broadcaster] 🔄 Track ended, re-acquiring camera stream...");

    try {
      // Acquire new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 30 }, facingMode: "user" },
        audio: true,
      });

      // Stop old tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      // Clean up old track-ended listeners
      trackEndedCleanupRef.current.forEach(fn => fn());
      trackEndedCleanupRef.current = [];

      streamRef.current = newStream;
      setLocalStream(newStream);

      // Replace tracks on all existing PeerConnections
      const newVideoTrack = newStream.getVideoTracks()[0];
      const newAudioTrack = newStream.getAudioTracks()[0];

      // Close all existing viewer connections (clean slate for new tracks)
      // Viewers will reconnect when they detect disconnection or via broadcaster-ready
      viewersRef.current.forEach(({ pc, viewerId }) => {
        pc.close();
        onViewerDisconnected?.(viewerId);
      });
      viewersRef.current.clear();
      processedJoinsRef.current.clear();
      setViewerCount(0);

      // Set up track-ended listeners on new tracks
      setupTrackEndedListeners(newStream);

      // Signal viewers to reconnect
      console.log("[WebRTC Broadcaster] ✅ Stream recovered, signaling broadcaster-ready");
      await cleanSignaling(deviceId, "broadcaster");
      await sendMsg("broadcaster-ready", { broadcasterId: sessionIdRef.current, reason: "stream-recovered" });

    } catch (err) {
      console.error("[WebRTC Broadcaster] ❌ Failed to recover stream:", err);
      onError?.("Camera recovery failed");
    } finally {
      isRecoveringRef.current = false;
    }
  }, [deviceId, sendMsg, onError, onViewerDisconnected]);

  // ── Track ended listeners ───────────────────────────────────────────────
  const setupTrackEndedListeners = useCallback((stream: MediaStream) => {
    // Clean up previous listeners
    trackEndedCleanupRef.current.forEach(fn => fn());
    trackEndedCleanupRef.current = [];

    stream.getTracks().forEach(track => {
      const handler = () => {
        console.log(`[WebRTC Broadcaster] ⚠️ Track ended: ${track.kind} (${track.label})`);
        // Only recover if we're still broadcasting
        if (streamRef.current === stream) {
          // Small delay to allow camera to reinitialize
          setTimeout(() => {
            if (streamRef.current && streamRef.current.getTracks().some(t => t.readyState === "ended")) {
              recoverStream();
            }
          }, 2000);
        }
      };
      track.addEventListener("ended", handler);
      trackEndedCleanupRef.current.push(() => track.removeEventListener("ended", handler));
    });
  }, [recoverStream]);

  // ── Create PC for a viewer ──────────────────────────────────────────────
  const createPCForViewer = useCallback((viewerId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMsg("ice-candidate", { candidate: event.candidate.toJSON() }, viewerId);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        viewersRef.current.delete(viewerId);
        setViewerCount(viewersRef.current.size);
        onViewerDisconnected?.(viewerId);
      }
    };

    return pc;
  }, [sendMsg, onViewerDisconnected]);

  // ── Handle viewer join ──────────────────────────────────────────────────
  const handleViewerJoin = useCallback(async (viewerId: string) => {
    // Triple lock: prevent duplicate offers
    if (processedJoinsRef.current.has(viewerId)) return;
    if (viewersRef.current.has(viewerId)) return;
    processedJoinsRef.current.add(viewerId);

    if (!streamRef.current) {
      processedJoinsRef.current.delete(viewerId);
      return;
    }

    // ★ Verify tracks are alive before creating offer
    const hasLiveTracks = streamRef.current.getTracks().some(t => t.readyState === "live");
    if (!hasLiveTracks) {
      console.log("[WebRTC Broadcaster] ⚠️ All tracks ended, recovering before joining viewer");
      processedJoinsRef.current.delete(viewerId);
      await recoverStream();
      return;
    }

    const pc = createPCForViewer(viewerId);
    viewersRef.current.set(viewerId, { pc, viewerId, hasRemoteDescription: false, pendingIceCandidates: [] });
    setViewerCount(viewersRef.current.size);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendMsg("offer", { type: "offer", sdp: offer.sdp }, viewerId);
      onViewerConnected?.(viewerId);
    } catch (err) {
      console.error("[WebRTC Broadcaster] Error creating offer:", err);
      pc.close();
      viewersRef.current.delete(viewerId);
      processedJoinsRef.current.delete(viewerId);
      setViewerCount(viewersRef.current.size);
    }
  }, [createPCForViewer, sendMsg, onViewerConnected, recoverStream]);

  // ── Handle signaling message ────────────────────────────────────────────
  const handleRecord = useCallback(async (record: SignalingRecord) => {
    if (processedRef.current.has(record.id)) return;
    processedRef.current.add(record.id);

    if (record.type === "viewer-join") {
      handleViewerJoin(record.data.viewerId || record.session_id);
      return;
    }

    // Find viewer connection
    const targetSession = record.data.target_session;
    const senderId = record.session_id;
    let vc: ViewerConnection | undefined;

    if (targetSession && viewersRef.current.has(targetSession)) {
      vc = viewersRef.current.get(targetSession);
    } else if (viewersRef.current.has(senderId)) {
      vc = viewersRef.current.get(senderId);
    } else {
      const first = viewersRef.current.entries().next().value;
      if (first) vc = first[1];
    }

    if (!vc) return;

    try {
      if (record.type === "answer" && !vc.hasRemoteDescription) {
        const sdp = extractSdp(record.data);
        if (!sdp) return;
        await vc.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
        vc.hasRemoteDescription = true;
        // Flush pending ICE
        for (const c of vc.pendingIceCandidates) {
          try { await vc.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
        }
        vc.pendingIceCandidates = [];
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        if (!vc.hasRemoteDescription) {
          vc.pendingIceCandidates.push(record.data.candidate);
        } else {
          await vc.pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
        }
      }
    } catch (err) {
      console.error("[WebRTC Broadcaster] Signaling error:", err);
    }
  }, [handleViewerJoin]);

  // ── Start broadcasting ──────────────────────────────────────────────────
  const startBroadcasting = useCallback(async () => {
    if (isBroadcasting) return;
    sessionIdRef.current = createSessionId("broadcaster");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 30 }, facingMode: "user" },
        audio: true,
      });

      streamRef.current = stream;
      setLocalStream(stream);

      // ★ Set up track-ended listeners for auto-recovery
      setupTrackEndedListeners(stream);

      await cleanSignaling(deviceId, "broadcaster");

      const channel = supabase
        .channel(`webrtc-signaling-broadcaster-${deviceId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "webrtc_signaling", filter: `device_id=eq.${deviceId}` },
          (payload) => {
            const record = payload.new as SignalingRecord;
            if (record.sender_type === "viewer") handleRecord(record);
          },
        )
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // Check for existing viewer-join requests
            const joins = await fetchViewerJoins(deviceId);
            for (const j of joins) handleRecord(j);
            setIsBroadcasting(true);
          } else if (status === "CHANNEL_ERROR") {
            onError?.("Signaling channel connection failed");
          }
        });

      channelRef.current = channel;

      // broadcaster-ready after 3s grace period
      setTimeout(() => {
        sendMsg("broadcaster-ready", { broadcasterId: sessionIdRef.current });
      }, 3000);
    } catch (err) {
      console.error("[WebRTC Broadcaster] Error starting:", err);
      cleanup();
      onError?.("Camera access failed. Please check permissions.");
    }
  }, [deviceId, isBroadcasting, cleanup, handleRecord, sendMsg, onError, setupTrackEndedListeners]);

  // ── Stop broadcasting ───────────────────────────────────────────────────
  const stopBroadcasting = useCallback(async () => {
    try { await cleanSignaling(deviceId, "broadcaster"); } catch { /* best effort */ }
    cleanup();
  }, [deviceId, cleanup]);

  // Cleanup on unmount
  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { isBroadcasting, localStream, viewerCount, startBroadcasting, stopBroadcasting };
};
