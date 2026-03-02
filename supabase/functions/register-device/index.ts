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

    // ★ 비스마트폰은 시리얼 키 필수
    if (isNonSmartphone(effectiveType) && !normalizedSerialKey) {
      return new Response(
        JSON.stringify({ error: "SERIAL_REQUIRED", message: "시리얼 키가 필요합니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
        // 비스마트폰: serial_key 기반으로만 기존 기기 매칭 (다중 기기 지원)
        // ★ 폴백 그룹 조회 제거: serial_key 없이는 새 기기 생성
        if (normalizedSerialKey) {
          // 1) metadata.serial_key로 조회
          const { data } = await supabaseAdmin
            .from("devices")
            .select("id, name, device_type, status, metadata")
            .eq("user_id", user_id)
            .in("device_type", nonSmartphoneTypes)
            .filter("metadata->>serial_key", "eq", normalizedSerialKey)
            .limit(1)
            .maybeSingle();
          if (data) existing = data;

          // 2) licenses 테이블에서 device_id 조회
          if (!existing) {
            const { data: licData } = await supabaseAdmin
              .from("licenses")
              .select("device_id")
              .eq("serial_key", normalizedSerialKey)
              .eq("user_id", user_id)
              .maybeSingle();
            if (licData?.device_id) {
              const { data: devData } = await supabaseAdmin
                .from("devices")
                .select("id, name, device_type, status, metadata")
                .eq("id", licData.device_id)
                .maybeSingle();
              if (devData) existing = devData;
            }
          }
        }
        // serial_key가 없으면 폴백 없이 새 기기 생성됨
      } else {
        // 스마트폰: 기존 로직 유지
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
    const finalName = device_name || "My Device";

    // ★ 기기명 중복 검사 (같은 user_id 내에서 동일 이름의 다른 기기가 있는지)
    if (finalName && finalName !== "My Device") {
      const { data: dupDevice } = await supabaseAdmin
        .from("devices")
        .select("id, name")
        .eq("user_id", user_id)
        .eq("name", finalName)
        .limit(1)
        .maybeSingle();

      if (dupDevice) {
        return new Response(
          JSON.stringify({ error: "DUPLICATE_DEVICE_NAME", message: `기기명 '${finalName}'은(는) 이미 사용 중입니다.` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const insertPayload: Record<string, unknown> = {
      user_id,
      name: finalName,
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
