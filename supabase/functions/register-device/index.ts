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
    const isNonSmartphone = (t: string) => t !== "smartphone";
    const nonSmartphoneTypes = ["laptop", "desktop", "tablet"];

    // ★ 기존 기기 조회: device_id_override가 UUID 형식이면 직접 조회, 아니면 user_id + device_type 그룹 조회
    let existing: any = null;

    if (device_id_override) {
      // UUID 형식 검증
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(device_id_override)) {
        const { data } = await supabaseAdmin
          .from("devices")
          .select("id, name, device_type, status, metadata")
          .eq("id", device_id_override)
          .maybeSingle();
        existing = data;
      }
    }

    if (!existing) {
      if (isNonSmartphone(effectiveType)) {
        // 비스마트폰: serial_key가 있으면 metadata.serial_key로 먼저 조회
        if (normalizedSerialKey) {
          const { data } = await supabaseAdmin
            .from("devices")
            .select("id, name, device_type, status, metadata")
            .eq("user_id", user_id)
            .in("device_type", nonSmartphoneTypes)
            .containedBy("metadata", { serial_key: normalizedSerialKey })
            .limit(1)
            .maybeSingle();
          if (data) existing = data;
        }

        // serial_key 매칭 실패 시 user_id + device_type 그룹 조회
        if (!existing) {
          const { data } = await supabaseAdmin
            .from("devices")
            .select("id, name, device_type, status, metadata")
            .eq("user_id", user_id)
            .in("device_type", nonSmartphoneTypes)
            .limit(1)
            .maybeSingle();
          existing = data;
        }
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
      const currentMeta = (existing.metadata as Record<string, unknown>) || {};
      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
      };

      // serial_key를 metadata에 저장 (핵심: 이것으로 DeviceManage에서 매칭)
      if (normalizedSerialKey) {
        updatePayload.metadata = { ...currentMeta, serial_key: normalizedSerialKey };
      }

      // 이름 변경 시 업데이트
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
