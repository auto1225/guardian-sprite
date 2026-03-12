import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── VAPID 키 관리 (Web Crypto API) ──

async function getOrCreateVapidKeys(
  supabaseAdmin: ReturnType<typeof createClient>
) {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "vapid_keys")
    .single();

  if (data?.value) return data.value as { publicKey: string; privateKey: string };

  // ECDSA P-256 키 생성
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  const publicKey = base64urlEncode(new Uint8Array(pubRaw));
  const privateKey = privJwk.d!; // base64url-encoded private key scalar

  const value = { publicKey, privateKey };
  await supabaseAdmin.from("system_settings").insert({ key: "vapid_keys", value });
  console.log("[push-notifications] VAPID keys generated");
  return value;
}

// ── Base64url 유틸 ──

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Improved VAPID key management (store full JWK) ──

async function getOrCreateVapidKeysV2(
  supabaseAdmin: ReturnType<typeof createClient>
) {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "vapid_keys_v2")
    .single();

  if (data?.value) return data.value as {
    publicKey: string;
    privateJwk: JsonWebKey;
    publicJwk: JsonWebKey;
  };

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const publicKey = base64urlEncode(new Uint8Array(pubRaw));

  const value = { publicKey, privateJwk, publicJwk };
  await supabaseAdmin.from("system_settings").insert({ key: "vapid_keys_v2", value });
  console.log("[push-notifications] VAPID keys v2 generated");
  return value;
}

async function createVapidAuth(
  endpoint: string,
  vapidKeys: { publicKey: string; privateJwk: JsonWebKey }
): Promise<{ authorization: string; cryptoKey: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: "mailto:meercop@example.com" };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { ...vapidKeys.privateJwk, key_ops: ["sign"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format (already raw from WebCrypto)
  const jwt = `${unsignedToken}.${base64urlEncode(new Uint8Array(signature))}`;

  return {
    authorization: `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
    cryptoKey: vapidKeys.publicKey,
  };
}

// ── Web Push 페이로드 암호화 (RFC 8291) ──

async function encryptPayload(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payloadText: string
) {
  const clientPublicKeyBytes = base64urlDecode(subscription.p256dh);
  const authSecret = base64urlDecode(subscription.auth);

  // 서버 임시 ECDH 키쌍 생성
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey)
  );

  // 클라이언트 공개키 import
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH 공유 비밀 생성
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPublicKey },
      serverKeys.privateKey,
      256
    )
  );

  // salt 생성 (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF를 사용한 키 유도
  const encoder = new TextEncoder();

  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const authInfo = encoder.encode("Content-Encoding: auth\0");
  const prkKey = await crypto.subtle.importKey(
    "raw",
    authSecret,
    { name: "HKDF" } as any,
    false,
    ["deriveBits"]
  );

  // Actually, Web Push uses a specific key derivation. Let me implement it properly.
  // IKM = ECDH(server_private, client_public)
  // PRK = HKDF-Extract(auth_secret, IKM)
  // Then derive CEK and nonce using info strings

  const ikmKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"]
  );

  // info for PRK
  const keyInfoBuf = createInfo("aesgcm", clientPublicKeyBytes, serverPublicKeyRaw);
  const nonceInfoBuf = createInfo("nonce", clientPublicKeyBytes, serverPublicKeyRaw);

  // PRK extraction with auth as salt
  const prkBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authSecret, info: encoder.encode("Content-Encoding: auth\0") },
    ikmKey,
    256
  );

  const prkKeyImported = await crypto.subtle.importKey(
    "raw",
    prkBits,
    "HKDF",
    false,
    ["deriveBits"]
  );

  // CEK (Content Encryption Key) - 16 bytes
  const cekBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: keyInfoBuf },
    prkKeyImported,
    128
  );

  // Nonce - 12 bytes
  const nonceBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfoBuf },
    prkKeyImported,
    96
  );

  // 패딩 추가 (2 bytes padding length = 0)
  const payloadBytes = encoder.encode(payloadText);
  const paddedPayload = new Uint8Array(2 + payloadBytes.length);
  paddedPayload.set([0, 0], 0);
  paddedPayload.set(payloadBytes, 2);

  // AES-128-GCM 암호화
  const cek = await crypto.subtle.importKey(
    "raw",
    cekBits,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBits },
    cek,
    paddedPayload
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    salt,
    serverPublicKey: serverPublicKeyRaw,
  };
}

function createInfo(
  type: string,
  clientPublicKey: Uint8Array,
  serverPublicKey: Uint8Array
): Uint8Array {
  const encoder = new TextEncoder();
  const label = encoder.encode(`Content-Encoding: ${type}\0`);
  const groupLabel = encoder.encode("P-256\0");

  const clientLen = new Uint8Array(2);
  clientLen[0] = 0;
  clientLen[1] = clientPublicKey.length;

  const serverLen = new Uint8Array(2);
  serverLen[0] = 0;
  serverLen[1] = serverPublicKey.length;

  const info = new Uint8Array(
    label.length +
    groupLabel.length +
    2 + clientPublicKey.length +
    2 + serverPublicKey.length
  );

  let offset = 0;
  info.set(label, offset); offset += label.length;
  info.set(groupLabel, offset); offset += groupLabel.length;
  info.set(clientLen, offset); offset += 2;
  info.set(clientPublicKey, offset); offset += clientPublicKey.length;
  info.set(serverLen, offset); offset += 2;
  info.set(serverPublicKey, offset);

  return info;
}

// ── 푸시 전송 ──

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidKeys: { publicKey: string; privateJwk: JsonWebKey }
) {
  const { authorization } = await createVapidAuth(subscription.endpoint, vapidKeys);
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, payload);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "Content-Length": String(ciphertext.length),
      TTL: "86400",
      Urgency: "high",
      Topic: "meercop-alert",
    },
    body: buildAes128GcmBody(salt, serverPublicKey, ciphertext),
  });

  if (!response.ok) {
    const text = await response.text();
    throw { statusCode: response.status, message: text };
  }

  // Consume response body
  await response.text();
}

function buildAes128GcmBody(
  salt: Uint8Array,
  serverPublicKey: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  // aes128gcm header: salt (16) + rs (4) + idlen (1) + keyid (65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  const idlen = new Uint8Array([serverPublicKey.length]);

  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length);
  let offset = 0;
  header.set(salt, offset); offset += 16;
  header.set(rs, offset); offset += 4;
  header.set(idlen, offset); offset += 1;
  header.set(serverPublicKey, offset);

  // Add record delimiter
  const record = new Uint8Array(ciphertext.length + 1);
  record.set(ciphertext, 0);
  record[ciphertext.length] = 2; // final record padding delimiter

  const body = new Uint8Array(header.length + record.length);
  body.set(header, 0);
  body.set(record, header.length);
  return body;
}

// ══════════════════════════════════════
// Main handler
// ══════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── VAPID 공개키 반환 (인증 불필요) ──
    if (action === "get-vapid-key") {
      const keys = await getOrCreateVapidKeysV2(supabaseAdmin);
      return jsonResponse({ vapidPublicKey: keys.publicKey });
    }

    // ── 푸시 구독 저장 (인증 필요) ──
    if (action === "subscribe") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: claims, error: claimsErr } = await userClient.auth.getUser();
      if (claimsErr || !claims.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { subscription, device_id } = body;
      if (!subscription?.endpoint || !subscription?.keys) {
        return jsonResponse({ error: "Invalid subscription" }, 400);
      }

      // Upsert subscription
      const { error: upsertErr } = await supabaseAdmin
        .from("push_subscriptions")
        .upsert(
          {
            user_id: claims.user.id,
            device_id: device_id || null,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
          { onConflict: "endpoint" }
        );

      if (upsertErr) {
        console.error("[push-notifications] Upsert error:", upsertErr);
        return jsonResponse({ error: "Failed to save subscription" }, 500);
      }

      return jsonResponse({ success: true });
    }

    // ── FCM 토큰 저장 (네이티브 앱용, 인증 필요) ──
    if (action === "subscribe-fcm") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: claims, error: claimsErr } = await userClient.auth.getUser();
      if (claimsErr || !claims.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { fcm_token, device_id } = body;
      if (!fcm_token) {
        return jsonResponse({ error: "fcm_token required" }, 400);
      }

      // Upsert by fcm_token
      const { error: upsertErr } = await supabaseAdmin
        .from("push_subscriptions")
        .upsert(
          {
            user_id: claims.user.id,
            device_id: device_id || null,
            token_type: "fcm",
            fcm_token: fcm_token,
            endpoint: `fcm://${fcm_token.slice(0, 20)}`,
            p256dh: "",
            auth: "",
          },
          { onConflict: "fcm_token" }
        );

      if (upsertErr) {
        console.error("[push-notifications] FCM upsert error:", upsertErr);
        return jsonResponse({ error: "Failed to save FCM token" }, 500);
      }

      console.log(`[push-notifications] ✅ FCM token saved for user=${claims.user.id.slice(0,8)}`);
      return jsonResponse({ success: true, token_type: "fcm" });
    }

    // ── 푸시 전송 (인증 필요) ──
    // 서버 측에서 5초 간격 × 5회 반복 전송 (노트북 네트워크 끊김 대비)
    if (action === "send") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: claims, error: claimsErr } = await userClient.auth.getUser();
      if (claimsErr || !claims.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { device_id, title, body: msgBody, tag, repeat = 5, interval = 5000 } = body;
      if (!device_id) return jsonResponse({ error: "device_id required" }, 400);

      // 디바이스 소유자 확인 + 기기 이름 조회
      const { data: device } = await supabaseAdmin
        .from("devices")
        .select("user_id, name")
        .eq("id", device_id)
        .single();

      if (!device || device.user_id !== claims.user.id) {
        return jsonResponse({ error: "Device not found or unauthorized" }, 403);
      }

      // 해당 사용자의 모든 구독 조회
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", device.user_id);

      if (!subs || subs.length === 0) {
        return jsonResponse({ sent: 0, message: "No subscriptions found" });
      }

      const vapidKeys = await getOrCreateVapidKeysV2(supabaseAdmin);

      const maxRepeat = Math.min(repeat, 5); // 최대 5회로 제한
      const delayMs = Math.max(interval, 3000); // 최소 3초 간격

      let totalSent = 0;
      const allErrors: string[] = [];

      for (let round = 0; round < maxRepeat; round++) {
        if (round > 0) {
          // 대기
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const deviceName = device.name || "알 수 없는 기기";
        const defaultTitle = `🚨 ${deviceName}에서 경보 발생`;
        const defaultBody = `${deviceName}에서 새로운 경보가 감지되었습니다!`;

        const payload = JSON.stringify({
          title: title || defaultTitle,
          body: msgBody || defaultBody,
          tag: tag || `meercop-alert-${device_id}`,
          icon: "/pwa-192x192.png",
          round: round + 1,
          maxRound: maxRepeat,
          device_id,
          device_name: deviceName,
        });

        for (const sub of subs) {
          try {
            if (sub.token_type === "fcm" && sub.fcm_token) {
              await sendFCMNotification(sub.fcm_token, payload, supabaseAdmin);
            } else if (sub.endpoint && sub.p256dh && sub.auth) {
              await sendPushNotification(
                { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                payload,
                vapidKeys
              );
            }
            totalSent++;
          } catch (err: any) {
            console.error(`[push-notifications] Send error (round ${round + 1}):`, err);
            if (err?.statusCode === 410 || err?.statusCode === 404) {
              await supabaseAdmin
                .from("push_subscriptions")
                .delete()
                .eq("id", sub.id);
            }
            allErrors.push(`round${round + 1}: ${err?.message || String(err)}`);
          }
        }

        console.log(`[push-notifications] Round ${round + 1}/${maxRepeat} done, sent to ${subs.length} subs`);
      }

    return jsonResponse({ sent: totalSent, rounds: maxRepeat, total_subs: subs.length, errors: allErrors });
    }

    // ── 서버 측 푸시 전송 (JWT 불필요 — 노트북/외부 프로젝트에서 호출) ──
    // 노트북이 경보 감지 시 이 엔드포인트를 호출하여 스마트폰에 OS 레벨 푸시 알림 전송
    if (action === "send-server") {
      const { user_id, device_id, device_name, title, body: msgBody, tag } = body;
      if (!user_id) return jsonResponse({ error: "user_id required" }, 400);

      // 해당 사용자의 모든 푸시 구독 조회
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", user_id);

      if (!subs || subs.length === 0) {
        return jsonResponse({ sent: 0, message: "No subscriptions found" });
      }

      const vapidKeys = await getOrCreateVapidKeysV2(supabaseAdmin);

      // 기기 이름 조회 (device_name이 없으면 DB에서 조회)
      let resolvedDeviceName = device_name;
      if (!resolvedDeviceName && device_id) {
        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("name")
          .eq("id", device_id)
          .single();
        resolvedDeviceName = device?.name;
      }
      resolvedDeviceName = resolvedDeviceName || "알 수 없는 기기";

      const defaultTitle = title || `🚨 ${resolvedDeviceName}에서 경보 발생`;
      const defaultBody = msgBody || `${resolvedDeviceName}에서 새로운 경보가 감지되었습니다!`;

      const payload = JSON.stringify({
        title: defaultTitle,
        body: defaultBody,
        tag: tag || `meercop-alert-${device_id || "unknown"}`,
        icon: "/pwa-192x192.png",
        device_id,
        device_name: resolvedDeviceName,
      });

      let sent = 0;
      const errors: string[] = [];

      for (const sub of subs) {
        try {
          await sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload,
            vapidKeys
          );
          sent++;
        } catch (err: any) {
          console.error("[push-notifications] send-server error:", err);
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await supabaseAdmin
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint);
          }
          errors.push(err?.message || String(err));
        }
      }

      console.log(`[push-notifications] send-server: sent=${sent}/${subs.length} for user=${user_id.slice(0,8)}`);
      return jsonResponse({ sent, total_subs: subs.length, errors });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[push-notifications] Error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
