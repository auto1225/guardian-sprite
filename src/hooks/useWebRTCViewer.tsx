import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";
import {
  ICE_SERVERS,
  CONNECTION_TIMEOUT_MS,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_COOLDOWN_MS,
  SIGNALING_POLL_INTERVAL_MS,
  VIEWER_JOIN_RETRY_MS,
  MAX_VIEWER_JOIN_RETRIES,
  BROADCASTER_READY_DEBOUNCE_MS,
  DISCONNECT_RECOVERY_MS,
} from "@/lib/webrtc/config";
import {
  SignalingRecord,
  sendSignaling,
  cleanSignaling,
  fetchLatestOffer,
  fetchBroadcasterIceCandidates,
  extractSdp,
  createSessionId,
} from "@/lib/webrtc/signaling";
import type { WebRTCViewerOptions } from "@/lib/webrtc/types";

// ─── Internal timer manager ─────────────────────────────────────────────────
// Centralised timer tracking prevents leaks and ensures full cleanup.
class TimerManager {
  private timeouts = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, NodeJS.Timeout>();

  setTimeout(key: string, fn: () => void, ms: number) {
    this.clearTimeout(key);
    this.timeouts.set(key, setTimeout(fn, ms));
  }
  clearTimeout(key: string) {
    const t = this.timeouts.get(key);
    if (t) { clearTimeout(t); this.timeouts.delete(key); }
  }
  setInterval(key: string, fn: () => void, ms: number) {
    this.clearInterval(key);
    this.intervals.set(key, setInterval(fn, ms));
  }
  clearInterval(key: string) {
    const t = this.intervals.get(key);
    if (t) { clearInterval(t); this.intervals.delete(key); }
  }
  clearAll() {
    this.timeouts.forEach(t => clearTimeout(t));
    this.intervals.forEach(t => clearInterval(t));
    this.timeouts.clear();
    this.intervals.clear();
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export const useWebRTCViewer = ({ deviceId, onError }: WebRTCViewerOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef(createSessionId("viewer"));
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const processedRef = useRef(new Set<string>());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const timers = useRef(new TimerManager()).current;

  // State guards (synchronous, never stale)
  const guards = useRef({
    connecting: false,
    connected: false,
    hasRemoteDesc: false,
    sentAnswer: false,
    processingOffer: false,
    lastJoinTs: 0,
    connectedAt: 0,
    reconnectAttempt: 0,
    joinRetryCount: 0,
  });

  // Stable reference to connect for reconnect scheduling
  const connectRef = useRef<() => void>(() => {});

  // ── Helpers ─────────────────────────────────────────────────────────────
  const sendMsg = useCallback(
    (type: string, data: Record<string, unknown>) =>
      sendSignaling(deviceId, sessionIdRef.current, "viewer", type, data),
    [deviceId],
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────
  const cleanup = useCallback((preserveStream = false) => {
    timers.clearAll();
    pcRef.current?.close();
    pcRef.current = null;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    processedRef.current.clear();
    pendingIceRef.current = [];
    const g = guards.current;
    g.connecting = false;
    g.connected = false;
    g.hasRemoteDesc = false;
    g.sentAnswer = false;
    g.processingOffer = false;
    g.joinRetryCount = 0;
    if (!preserveStream) setRemoteStream(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, [timers]);

  // ── Schedule reconnect with exponential backoff ─────────────────────────
  const scheduleReconnect = useCallback(() => {
    const g = guards.current;
    if (g.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      onError?.(i18n.t("camera.disconnected"));
      return;
    }
    if (Date.now() - g.connectedAt < RECONNECT_COOLDOWN_MS) return;

    const delay = g.reconnectAttempt === 0 ? 0 : Math.pow(2, g.reconnectAttempt) * 1000;
    g.reconnectAttempt++;
    timers.setTimeout("reconnect", () => {
      const g2 = guards.current;
      if (!g2.connected && !g2.connecting) connectRef.current();
    }, delay);
  }, [onError, timers]);

  // ── Process pending ICE candidates ──────────────────────────────────────
  const flushIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !guards.current.hasRemoteDesc) return;
    const pending = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const c of pending) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore stale */ }
    }
  }, []);

  // ── Handle a single signaling record ────────────────────────────────────
  const handleRecord = useCallback(async (record: SignalingRecord) => {
    if (processedRef.current.has(record.id)) return;
    processedRef.current.add(record.id);

    const pc = pcRef.current;
    if (!pc) return;
    const g = guards.current;

    try {
      if (record.type === "offer") {
        // Target session filter
        const target = (record.data as Record<string, unknown>).target_session as string | undefined;
        if (target && target !== sessionIdRef.current) return;
        if (g.processingOffer || g.sentAnswer || g.hasRemoteDesc) return;

        g.processingOffer = true;
        const sdp = extractSdp(record.data);
        if (!sdp) { g.processingOffer = false; onError?.(i18n.t("camera.invalidSdp")); return; }

        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
        g.hasRemoteDesc = true;

        await flushIceCandidates();

        if (!g.sentAnswer) {
          g.sentAnswer = true;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendMsg("answer", { type: "answer", sdp: answer.sdp, target_session: sessionIdRef.current });

          // SDP exchange complete — stop polling/retries
          timers.clearInterval("offerPoll");
          timers.clearInterval("joinRetry");
        }
        g.processingOffer = false;
      } else if (record.type === "ice-candidate" && record.data.candidate) {
        const target = (record.data as Record<string, unknown>).target_session as string | undefined;
        if (target && target !== sessionIdRef.current) return;

        if (!g.hasRemoteDesc) {
          pendingIceRef.current.push(record.data.candidate);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(record.data.candidate));
        }
      }
    } catch (err) {
      console.error("[WebRTC Viewer] Signaling error:", err);
      g.processingOffer = false;
      onError?.(i18n.t("camera.signalingError"));
    }
  }, [sendMsg, onError, flushIceCandidates, timers]);

  // ── Reset PC and rejoin (for broadcaster-ready) ─────────────────────────
  const resetAndRejoin = useCallback((reason: string) => {
    console.log(`[WebRTC Viewer] 🔄 resetAndRejoin (${reason})`);
    pcRef.current?.close();
    pcRef.current = null;

    const g = guards.current;
    processedRef.current.clear();
    pendingIceRef.current = [];
    g.hasRemoteDesc = false;
    g.sentAnswer = false;
    g.processingOffer = false;

    sessionIdRef.current = createSessionId("viewer");
    g.connected = false;
    g.connecting = true;
    setIsConnected(false);
    setIsConnecting(true);
    setRemoteStream(null);

    pcRef.current = createPC();

    timers.setTimeout("rejoin-delay", () => {
      sendMsg("viewer-join", { viewerId: sessionIdRef.current, reason });
      g.lastJoinTs = Date.now();
    }, 1000);
  }, [sendMsg, timers]); // createPC added below via ref pattern

  // ── Create PeerConnection ───────────────────────────────────────────────
  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    let nativeStream: MediaStream | null = null;

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (stream) {
        nativeStream = stream;
        setRemoteStream(stream);
      } else {
        if (!nativeStream) nativeStream = new MediaStream();
        if (!nativeStream.getTracks().find(t => t.id === event.track.id)) {
          nativeStream.addTrack(event.track);
        }
        setRemoteStream(nativeStream);
      }
      timers.clearTimeout("connectionTimeout");
      timers.clearInterval("offerPoll");
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMsg("ice-candidate", { candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        const g = guards.current;
        g.connected = true;
        g.connecting = false;
        g.reconnectAttempt = 0;
        g.connectedAt = Date.now();
        setIsConnected(true);
        setIsConnecting(false);
        timers.clearTimeout("connectionTimeout");
        timers.clearInterval("offerPoll");

        // ★ Stale track detection: if no video frames arrive within 8s, reconnect
        timers.setTimeout("staleTrackCheck", () => {
          const videoTrack = pc.getReceivers().find(r => r.track?.kind === "video")?.track;
          if (!videoTrack || videoTrack.muted || videoTrack.readyState === "ended") {
            console.log("[WebRTC Viewer] ⚠️ Stale track detected after connection, forcing reconnect");
            cleanup(false);
            // Reset reconnect counter for this specific case
            guards.current.reconnectAttempt = 0;
            timers.setTimeout("staleReconnect", () => connectRef.current(), 1000);
          }
        }, 8000);
      } else if (state === "disconnected") {
        guards.current.connected = false;
        setIsConnected(false);
        setIsConnecting(false);
        timers.setTimeout("disconnectRecovery", () => {
          if (pcRef.current?.connectionState === "disconnected") {
            cleanup(true);
            scheduleReconnect();
          }
        }, DISCONNECT_RECOVERY_MS);
      } else if (state === "failed") {
        guards.current.connecting = false;
        guards.current.connected = false;
        cleanup(true);
        scheduleReconnect();
      }
    };

    pc.oniceconnectionstatechange = () => {
      // Informational only — connection state handler covers lifecycle
    };

    return pc;
  }, [sendMsg, cleanup, scheduleReconnect, timers]);

  // Patch resetAndRejoin to use latest createPC
  const createPCRef = useRef(createPC);
  createPCRef.current = createPC;

  // ── Connect ─────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    const g = guards.current;
    if (g.connecting || g.connected) return;
    g.connecting = true;
    setIsConnecting(true);

    // Full reset
    pcRef.current?.close();
    pcRef.current = null;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    processedRef.current.clear();
    pendingIceRef.current = [];
    g.hasRemoteDesc = false;
    g.sentAnswer = false;
    g.processingOffer = false;
    g.joinRetryCount = 0;
    timers.clearAll();
    setRemoteStream(null);

    sessionIdRef.current = createSessionId("viewer");

    // Helper: check for existing offer
    const checkOffer = async (): Promise<boolean> => {
      if (g.hasRemoteDesc || g.sentAnswer) return true;
      const offer = await fetchLatestOffer(deviceId);
      if (offer) {
        console.log("[WebRTC Viewer] ✅ Found existing offer, processing...");
        handleRecord(offer);
        return true;
      }
      return false;
    };

    try {
      // Clean old viewer signaling
      await cleanSignaling(deviceId, "viewer");
      console.log("[WebRTC Viewer] Old signaling cleaned");

      // Create PC
      pcRef.current = createPC();

      // Send viewer-join
      g.lastJoinTs = Date.now();
      await sendMsg("viewer-join", { viewerId: sessionIdRef.current });

      // Subscribe to realtime
      const existingChannels = supabase.getChannels();
      existingChannels.forEach(ch => {
        if (ch.topic.includes(`webrtc-signaling-viewer-${deviceId}`)) {
          supabase.removeChannel(ch);
        }
      });

      const channelName = `webrtc-signaling-viewer-${deviceId}-${Date.now()}`;
      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "webrtc_signaling", filter: `device_id=eq.${deviceId}` },
          (payload) => {
            const record = payload.new as SignalingRecord;
            if (record.sender_type !== "broadcaster") return;

            // Handle broadcaster-ready
            if (record.type === "broadcaster-ready") {
              const g2 = guards.current;
              if (Date.now() - g2.lastJoinTs < BROADCASTER_READY_DEBOUNCE_MS) return;
              if (g2.hasRemoteDesc || g2.sentAnswer) return;
              resetAndRejoin("broadcaster-ready");
              return;
            }

            console.log("[WebRTC Viewer] ✅ Received:", record.type, "from broadcaster");
            handleRecord(record);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[WebRTC Viewer] ✅ Channel subscribed");
            checkOffer();
          }
        });

      channelRef.current = channel;

      // Initial offer check + retry loop
      const initialFound = await checkOffer();
      if (!initialFound) {
        // Retry viewer-join every 2s, max 5 times
        timers.setInterval("joinRetry", async () => {
          const g2 = guards.current;
          if (g2.hasRemoteDesc || g2.connected || !g2.connecting) {
            timers.clearInterval("joinRetry");
            return;
          }
          g2.joinRetryCount++;
          const found = await checkOffer();
          if (!found && g2.joinRetryCount <= MAX_VIEWER_JOIN_RETRIES) {
            await sendMsg("viewer-join", { viewerId: sessionIdRef.current, retry: g2.joinRetryCount });
          }
          if (g2.joinRetryCount >= MAX_VIEWER_JOIN_RETRIES) {
            timers.clearInterval("joinRetry");
          }
        }, VIEWER_JOIN_RETRY_MS);
      }

      // Signaling poll fallback (after 2s grace)
      timers.setTimeout("startPoll", () => {
        const g2 = guards.current;
        if (!g2.connecting || g2.connected || g2.hasRemoteDesc) return;
        timers.setInterval("offerPoll", async () => {
          const g3 = guards.current;
          if (g3.connected || !g3.connecting) { timers.clearInterval("offerPoll"); return; }
          if (!g3.hasRemoteDesc) await checkOffer();
          // Also poll ICE candidates
          if (g3.hasRemoteDesc && pcRef.current) {
            const candidates = await fetchBroadcasterIceCandidates(deviceId);
            for (const c of candidates) {
              if (!processedRef.current.has(c.id)) handleRecord(c);
            }
          }
        }, SIGNALING_POLL_INTERVAL_MS);
      }, 2000);

      // Connection timeout
      timers.setTimeout("connectionTimeout", () => {
        const g2 = guards.current;
        if (g2.connecting && !g2.connected) {
          g2.connecting = false;
          cleanup();
          onError?.(i18n.t("camera.connectionTimeout"));
        }
      }, CONNECTION_TIMEOUT_MS);

    } catch (err) {
      console.error("[WebRTC Viewer] Error connecting:", err);
      g.connecting = false;
      cleanup();
      onError?.(i18n.t("camera.connectionError2"));
    }
  }, [deviceId, cleanup, createPC, sendMsg, handleRecord, onError, resetAndRejoin, timers]);

  connectRef.current = connect;

  // ── Disconnect ──────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    guards.current.connecting = false;
    cleanup(false);
    try { await cleanSignaling(deviceId, "viewer"); } catch { /* best effort */ }
  }, [deviceId, cleanup]);

  // ── Unmount cleanup ─────────────────────────────────────────────────────
  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { isConnecting, isConnected, remoteStream, connect, disconnect };
};
