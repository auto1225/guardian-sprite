// WebRTC shared configuration — single source of truth
// Frozen to prevent accidental mutation

export const ICE_SERVERS: RTCConfiguration = Object.freeze({
  iceServers: Object.freeze([
    Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
    Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
    Object.freeze({ urls: "stun:stun2.l.google.com:19302" }),
    Object.freeze({ urls: "stun:stun3.l.google.com:19302" }),
    Object.freeze({ urls: "stun:stun4.l.google.com:19302" }),
  ]) as unknown as RTCIceServer[],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle" as RTCBundlePolicy,
});

/** Offer validity window (ms) — offers older than this are ignored */
export const OFFER_VALIDITY_MS = 60_000;

/** Polling interval for signaling fallback (ms) */
export const SIGNALING_POLL_INTERVAL_MS = 3_000;

/** Connection timeout (ms) */
export const CONNECTION_TIMEOUT_MS = 30_000;

/** Max reconnect attempts */
export const MAX_RECONNECT_ATTEMPTS = 3;

/** Reconnect cooldown after success (ms) */
export const RECONNECT_COOLDOWN_MS = 5_000;

/** Viewer-join retry interval (ms) */
export const VIEWER_JOIN_RETRY_MS = 2_000;

/** Max viewer-join retries */
export const MAX_VIEWER_JOIN_RETRIES = 5;

/** Broadcaster-ready debounce window (ms) */
export const BROADCASTER_READY_DEBOUNCE_MS = 2_000;

/** Disconnected recovery wait time (ms) */
export const DISCONNECT_RECOVERY_MS = 10_000;
