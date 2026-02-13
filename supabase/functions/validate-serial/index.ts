import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    // Service role로 라이선스 조회
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

    // 이미 등록된 디바이스 확인 또는 새로 등록
    const { data: existingDevices } = await supabaseAdmin
      .from("devices")
      .select("id, name")
      .eq("user_id", license.user_id);

    let deviceId: string;

    if (existingDevices && existingDevices.length > 0) {
      // 기존 디바이스 반환
      deviceId = existingDevices[0].id;
      
      // 상태 업데이트
      await supabaseAdmin
        .from("devices")
        .update({
          status: "online",
          last_seen_at: new Date().toISOString(),
          device_type: device_type || "laptop",
        })
        .eq("id", deviceId);
    } else {
      // 새 디바이스 등록
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
        return new Response(
          JSON.stringify({ error: "기기 등록에 실패했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      deviceId = newDevice.id;
    }

    return new Response(
      JSON.stringify({
        success: true,
        device_id: deviceId,
        user_id: license.user_id,
        serial_key: license.serial_key,
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
