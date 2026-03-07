import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── IP 기반 레이트 리밋 (5회/15분) ──
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, valid);
  }
}, 30 * 60 * 1000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again in 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { serial_key, device_name, device_type } = await req.json();

    if (!serial_key || typeof serial_key !== "string") {
      return new Response(
        JSON.stringify({ error: "Please enter a serial number." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedKey = serial_key.trim().toUpperCase();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: license, error: licenseError } = await supabaseAdmin
      .from("licenses")
      .select("*")
      .eq("serial_key", normalizedKey)
      .single();

    if (licenseError || !license) {
      return new Response(
        JSON.stringify({ error: "Invalid serial number." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!license.is_active) {
      return new Response(
        JSON.stringify({ error: "This serial number is inactive. Please check your subscription." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "This serial number has expired. Please renew your subscription." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 남은 일수 계산
    let remaining_days: number | null = null;
    if (license.expires_at) {
      const now = new Date();
      const expires = new Date(license.expires_at);
      remaining_days = Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }

    // 이미 기기가 연결된 시리얼인지 확인
    if (license.device_id) {
      // ★ 기존 기기 이름 조회 (재접속 시 이름 덮어쓰기 방지)
      const { data: existingDevice } = await supabaseAdmin
        .from("devices")
        .select("name")
        .eq("id", license.device_id)
        .maybeSingle();

      const existingName = existingDevice?.name;
      const isDefaultName = !existingName || existingName === "My Device" || existingName === "Laptop";

      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
      };
      // ★ 기존 이름이 기본값일 때만 덮어쓰기 허용 (register-device와 동일한 정책)
      if (device_name && isDefaultName) updatePayload.name = device_name;
      if (device_type) updatePayload.device_type = device_type;

      await supabaseAdmin
        .from("devices")
        .update(updatePayload)
        .eq("id", license.device_id);

      return new Response(
        JSON.stringify({
          success: true,
          device_id: license.device_id,
          user_id: license.user_id,
          serial_key: license.serial_key,
          plan_type: license.plan_type || "free",
          expires_at: license.expires_at,
          remaining_days,
          reconnected: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 새 기기 등록
    const { data: newDevice, error: deviceError } = await supabaseAdmin
      .from("devices")
      .insert({
        user_id: license.user_id,
        name: device_name || "My Device",
        device_type: device_type || "laptop",
        status: "online",
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (deviceError || !newDevice) {
      console.error("Device creation error:", deviceError);
      return new Response(
        JSON.stringify({ error: "Failed to register device." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin
      .from("licenses")
      .update({ device_id: newDevice.id })
      .eq("id", license.id);

    return new Response(
      JSON.stringify({
        success: true,
        device_id: newDevice.id,
        user_id: license.user_id,
        serial_key: license.serial_key,
        plan_type: license.plan_type || "free",
        expires_at: license.expires_at,
        remaining_days,
        reconnected: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("validate-serial error:", err);
    return new Response(
      JSON.stringify({ error: "Server error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
