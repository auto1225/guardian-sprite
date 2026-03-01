// WebRTC signaling helpers — encapsulated DB interactions
import { supabase } from "@/integrations/supabase/client";
import { OFFER_VALIDITY_MS } from "./config";

export interface SignalingRecord {
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
    broadcasterId?: string;
    reason?: string;
    retry?: number;
  };
  created_at: string;
}

/**
 * Insert a signaling record into the DB.
 * All data is deep-cloned to prevent reference issues.
 */
export async function sendSignaling(
  deviceId: string,
  sessionId: string,
  senderType: "viewer" | "broadcaster",
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("webrtc_signaling").insert([{
    device_id: deviceId,
    session_id: sessionId,
    type,
    sender_type: senderType,
    data: JSON.parse(JSON.stringify(data)),
  }]);

  if (error) {
    console.error(`[WebRTC ${senderType}] Failed to send signaling:`, error);
    throw error;
  }
  console.log(`[WebRTC ${senderType}] ✅ Signaling sent:`, type);
}

/**
 * Delete old signaling records for a device + sender type.
 */
export async function cleanSignaling(deviceId: string, senderType: "viewer" | "broadcaster"): Promise<void> {
  await supabase
    .from("webrtc_signaling")
    .delete()
    .eq("device_id", deviceId)
    .eq("sender_type", senderType);
}

/**
 * Fetch the latest valid offer from the broadcaster.
 * Only returns offers created within OFFER_VALIDITY_MS.
 */
export async function fetchLatestOffer(deviceId: string): Promise<SignalingRecord | null> {
  const cutoff = new Date(Date.now() - OFFER_VALIDITY_MS).toISOString();
  const { data, error } = await supabase
    .from("webrtc_signaling")
    .select("*")
    .eq("device_id", deviceId)
    .eq("sender_type", "broadcaster")
    .eq("type", "offer")
    .gt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[WebRTC Viewer] Error fetching offer:", error);
    return null;
  }

  return (data && data.length > 0) ? data[0] as SignalingRecord : null;
}

/**
 * Fetch unprocessed ICE candidates from the broadcaster.
 */
export async function fetchBroadcasterIceCandidates(deviceId: string): Promise<SignalingRecord[]> {
  const { data } = await supabase
    .from("webrtc_signaling")
    .select("*")
    .eq("device_id", deviceId)
    .eq("sender_type", "broadcaster")
    .eq("type", "ice-candidate")
    .order("created_at", { ascending: true });

  return (data ?? []) as SignalingRecord[];
}

/**
 * Fetch existing viewer-join records for a device.
 */
export async function fetchViewerJoins(deviceId: string): Promise<SignalingRecord[]> {
  const { data } = await supabase
    .from("webrtc_signaling")
    .select("*")
    .eq("device_id", deviceId)
    .eq("sender_type", "viewer")
    .eq("type", "viewer-join")
    .order("created_at", { ascending: false });

  return (data ?? []) as SignalingRecord[];
}

/**
 * Extract SDP string from various data formats.
 * Handles both `data.sdp: string` and `data.sdp: { sdp: string }`.
 */
export function extractSdp(data: SignalingRecord["data"]): string | undefined {
  if (typeof data.sdp === "string") return data.sdp;
  if (data.sdp && typeof data.sdp === "object" && "sdp" in data.sdp) {
    return (data.sdp as { sdp: string }).sdp;
  }
  return undefined;
}

/**
 * Generate a unique session ID.
 */
export function createSessionId(prefix: "viewer" | "broadcaster"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Subscribe to signaling channel for a device.
 * Returns cleanup function.
 */
export function subscribeToSignaling(
  deviceId: string,
  channelSuffix: string,
  onRecord: (record: SignalingRecord) => void,
  onSubscribed?: () => void,
): { channel: ReturnType<typeof supabase.channel>; cleanup: () => void } {
  // Remove existing channels for this device
  const existingChannels = supabase.getChannels();
  existingChannels.forEach(ch => {
    if (ch.topic.includes(channelSuffix)) {
      supabase.removeChannel(ch);
    }
  });

  const channelName = `${channelSuffix}-${Date.now()}`;
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
        onRecord(payload.new as SignalingRecord);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onSubscribed?.();
      } else if (status === "CHANNEL_ERROR") {
        console.error(`[WebRTC] ❌ Channel error: ${channelName}`);
      }
    });

  return {
    channel,
    cleanup: () => supabase.removeChannel(channel),
  };
}
