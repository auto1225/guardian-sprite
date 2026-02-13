import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { serial_key, device_name, device_type } = await req.json();

    if (!serial_key || typeof serial_key !== "string") {
      return new Response(
        JSON.stringify({ error: "시리얼 넘버를 입력해주세요." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedKey = serial_key.trim().toUpperCase();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 시리얼 조회
    const { data: license, error: licenseError } = await supabaseAdmin
      .from("licenses")
      .select("*")
      .eq("serial_key", normalizedKey)
      .single();

    if (licenseError || !license) {
      return new Response(
        JSON.stringify({ error: "유효하지 않은 시리얼 넘버입니다." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!license.is_active) {
      return new Response(
        JSON.stringify({ error: "비활성화된 시리얼 넘버입니다. 구독을 확인해주세요." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "만료된 시리얼 넘버입니다. 구독을 갱신해주세요." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 이미 기기가 연결된 시리얼인지 확인
    if (license.device_id) {
      // 기존 기기 상태 업데이트 (재연결) - 이름도 함께 갱신
      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
      };
      if (device_name) {
        updatePayload.name = device_name;
      }
      if (device_type) {
        updatePayload.device_type = device_type;
      }
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
        name: device_name || "My Computer",
        device_type: device_type || "laptop",
        status: "online",
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (deviceError || !newDevice) {
      console.error("Device creation error:", deviceError);
      return new Response(
        JSON.stringify({ error: "기기 등록에 실패했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 라이선스에 기기 ID 연결
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
        reconnected: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("validate-serial error:", err);
    return new Response(
      JSON.stringify({ error: "서버 오류가 발생했습니다." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
