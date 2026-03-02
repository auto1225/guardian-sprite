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
    const { user_id, device_name, device_type, serial_key } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizedSerialKey = serial_key ? String(serial_key).trim().toUpperCase() : null;
    const effectiveType = device_type || "laptop";
    // laptop/desktop/tablet are treated as the same "non-smartphone" group to prevent duplicates
    // 설정에서 기기타입을 변경해도 기존 레코드를 재사용
    const isNonSmartphone = (t: string) => t !== "smartphone";
    const nonSmartphoneTypes = ["laptop", "desktop", "tablet"];

    // 같은 user_id + device_type 그룹으로 이미 존재하는지 확인 (이름 무관 — 중복 방지)
    let existing: any = null;
    if (isNonSmartphone(effectiveType)) {
      // 비스마트폰 그룹: laptop, desktop, tablet 중 하나라도 있으면 재사용
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, name, device_type, status")
        .eq("user_id", user_id)
        .in("device_type", nonSmartphoneTypes)
        .limit(1)
        .maybeSingle();
      existing = data;
    } else {
      // smartphone: 정확한 타입 매칭
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, name, device_type, status")
        .eq("user_id", user_id)
        .eq("device_type", effectiveType)
        .limit(1)
        .maybeSingle();
      existing = data;
    }

    if (existing) {
      // 기존 기기 재연결
      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
      };

      // serial_key가 제공되면 metadata에 저장
      if (normalizedSerialKey) {
        const { data: currentDevice } = await supabaseAdmin
          .from("devices")
          .select("metadata")
          .eq("id", existing.id)
          .single();
        const currentMeta = (currentDevice?.metadata as Record<string, unknown>) || {};
        updatePayload.metadata = { ...currentMeta, serial_key: normalizedSerialKey };
      }

      await supabaseAdmin
        .from("devices")
        .update(updatePayload)
        .eq("id", existing.id);

      // licenses 테이블 upsert (serial_key → device_id 매핑)
      if (normalizedSerialKey) {
        await supabaseAdmin
          .from("licenses")
          .upsert(
            { serial_key: normalizedSerialKey, device_id: existing.id, user_id, is_active: true },
            { onConflict: "serial_key" }
          );
      }

      return new Response(
        JSON.stringify({
          success: true,
          device_id: existing.id,
          reconnected: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 새 기기 등록
    const insertPayload: Record<string, unknown> = {
      user_id,
      name: device_name || "My Device",
      device_type: effectiveType,
      status: "online",
      last_seen_at: new Date().toISOString(),
    };
    if (normalizedSerialKey) {
      insertPayload.metadata = { serial_key: normalizedSerialKey };
    }

    const { data: newDevice, error } = await supabaseAdmin
      .from("devices")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("register-device insert error:", error);
      return new Response(
        JSON.stringify({ error: "기기 등록에 실패했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // licenses 테이블 upsert (serial_key → device_id 매핑)
    if (normalizedSerialKey) {
      await supabaseAdmin
        .from("licenses")
        .upsert(
          { serial_key: normalizedSerialKey, device_id: newDevice.id, user_id, is_active: true },
          { onConflict: "serial_key" }
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        device_id: newDevice.id,
        reconnected: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("register-device error:", err);
    return new Response(
      JSON.stringify({ error: "서버 오류가 발생했습니다." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
