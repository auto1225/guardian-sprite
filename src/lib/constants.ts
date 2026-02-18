// src/lib/constants.ts
// 공통 상수 — MeerCOP 스마트폰 앱 (CODE_IMPROVEMENT_GUIDE §2-6)

export const HEARTBEAT_INTERVAL_MS = 120_000;       // 2분 (§2-3: 30초→120초)
export const GPS_TIMEOUT_MS = 5_000;
export const PHOTO_CHUNK_SIZE = 2;
export const PHOTO_CHUNK_DELAY_MS = 300;
export const DEFAULT_PIN = "1234";
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 300_000;               // 5분
export const MAX_PENDING_PHOTOS = 5;
export const PRESENCE_THROTTLE_MS = 1_000;

// WebRTC
export const WEBRTC_CONNECTION_TIMEOUT_MS = 30_000;
export const WEBRTC_DISCONNECTED_RECOVERY_MS = 10_000;

// Rate limiting (Edge Function)
export const SERIAL_RATE_LIMIT_MAX = 5;
export const SERIAL_RATE_LIMIT_WINDOW_MS = 900_000;  // 15분
