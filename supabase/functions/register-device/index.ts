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
    const { user_id, device_name, device_type, serial_key, device_id_override } = await req.json();

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

    // ★ device_id 결정: serial_key 기반 고유 ID 또는 override 또는 기존 로직
    let determinedDeviceId: string | null = device_id_override || null;

    if (!determinedDeviceId && normalizedSerialKey && effectiveType !== "smartphone") {
      // 시리얼 키 기반 고유 device_id: user_id_serialkey_type
      const sanitizedSerial = normalizedSerialKey.replace(/[^A-Z0-9]/g, "").toLowerCase();
      determinedDeviceId = `${user_id}_${sanitizedSerial}_${effectiveType}`;
    }

    // smartphone은 기존 device_id_override 방식 유지
    if (effectiveType === "smartphone" && !determinedDeviceId) {
      determinedDeviceId = `${user_id}-smartphone`;
    }

    // 기존 기기 조회
    let existing: any = null;

    if (determinedDeviceId) {
      // 결정된 ID로 직접 조회
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, name, device_type, status, metadata")
        .eq("id", determinedDeviceId)
        .maybeSingle();
      existing = data;
    } else {
      // ID 미결정 시 user_id + device_type 그룹으로 조회 (레거시 폴백)
      const nonSmartphoneTypes = ["laptop", "desktop", "tablet"];
      const isNonSmartphone = effectiveType !== "smartphone";

      if (isNonSmartphone) {
        const { data } = await supabaseAdmin
          .from("devices")
          .select("id, name, device_type, status, metadata")
          .eq("user_id", user_id)
          .in("device_type", nonSmartphoneTypes)
          .limit(1)
          .maybeSingle();
        existing = data;
      } else {
        const { data } = await supabaseAdmin
          .from("devices")
          .select("id, name, device_type, status, metadata")
          .eq("user_id", user_id)
          .eq("device_type", effectiveType)
          .limit(1)
          .maybeSingle();
        existing = data;
      }
    }

    if (existing) {
      // 기존 기기 재연결
      const currentMeta = (existing.metadata as Record<string, unknown>) || {};
      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
        device_type: effectiveType,
      };

      if (normalizedSerialKey) {
        updatePayload.metadata = { ...currentMeta, serial_key: normalizedSerialKey };
      }

      // 이름이 변경된 경우 업데이트
      if (device_name && device_name !== existing.name) {
        updatePayload.name = device_name;
      }

      await supabaseAdmin
        .from("devices")
        .update(updatePayload)
        .eq("id", existing.id);

      // licenses 테이블 upsert
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

    if (determinedDeviceId) {
      insertPayload.id = determinedDeviceId;
    }

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

    // licenses 테이블 upsert
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
