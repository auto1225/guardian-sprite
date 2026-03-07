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
    const isController = effectiveType === "smartphone" && !normalizedSerialKey;
    const managedDeviceTypes = ["laptop", "desktop", "tablet", "smartphone"];

    if (!isController && !normalizedSerialKey) {
      return new Response(
        JSON.stringify({ error: "SERIAL_REQUIRED", message: "시리얼 키가 필요합니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ★ 시리얼 키가 있으면 licenses.device_name을 SSOT로 사용
    let licenseDeviceName: string | null = null;
    if (normalizedSerialKey) {
      const { data: licRecord } = await supabaseAdmin
        .from("licenses")
        .select("device_name, device_id")
        .eq("serial_key", normalizedSerialKey)
        .eq("user_id", user_id)
        .maybeSingle();
      licenseDeviceName = licRecord?.device_name || null;
    }

    // ★ 기존 기기 조회
    let existing: any = null;

    if (device_id_override) {
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
      if (!isController && normalizedSerialKey) {
        const { data: allMatches } = await supabaseAdmin
          .from("devices")
          .select("id, name, device_type, status, metadata, created_at")
          .eq("user_id", user_id)
          .in("device_type", managedDeviceTypes)
          .filter("metadata->>serial_key", "eq", normalizedSerialKey)
          .order("created_at", { ascending: false });

        if (allMatches && allMatches.length > 0) {
          existing = allMatches[0];
          if (allMatches.length > 1) {
            console.log(`[register-device] 🗑️ Cleaning ${allMatches.length - 1} duplicate(s) for serial ${normalizedSerialKey}`);
            for (let i = 1; i < allMatches.length; i++) {
              await supabaseAdmin.from("licenses").update({ device_id: null }).eq("device_id", allMatches[i].id);
              await supabaseAdmin.from("devices").delete().eq("id", allMatches[i].id);
            }
          }
        }

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
      } else if (isController) {
        const { data: controllers } = await supabaseAdmin
          .from("devices")
          .select("id, name, device_type, status, metadata")
          .eq("user_id", user_id)
          .eq("device_type", "smartphone")
          .order("created_at", { ascending: true });

        const controllerDevice = controllers?.find(
          (d: any) => !((d.metadata as Record<string, unknown>)?.serial_key)
        );
        if (controllerDevice) existing = controllerDevice;
      }
    }

    if (existing) {
      const currentMeta = (existing.metadata as Record<string, unknown>) || {};
      const updatePayload: Record<string, unknown> = {
        status: "online",
        last_seen_at: new Date().toISOString(),
      };

      if (normalizedSerialKey) {
        updatePayload.metadata = { ...currentMeta, serial_key: normalizedSerialKey };
      }

      // ★ licenses.device_name이 SSOT — 있으면 devices.name 동기화
      const authoritativeName = licenseDeviceName || device_name || existing.name;
      if (authoritativeName && authoritativeName !== existing.name) {
        updatePayload.name = authoritativeName;
        console.log(`[register-device] 📛 Name synced from licenses SSOT: "${existing.name}" → "${authoritativeName}"`);
      }

      await supabaseAdmin
        .from("devices")
        .update(updatePayload)
        .eq("id", existing.id);

      // licenses 테이블 upsert (device_name 포함)
      if (normalizedSerialKey) {
        await supabaseAdmin
          .from("licenses")
          .upsert(
            {
              serial_key: normalizedSerialKey,
              device_id: existing.id,
              user_id,
              is_active: true,
              device_name: authoritativeName,
            },
            { onConflict: "serial_key" }
          );
      }

      return new Response(
        JSON.stringify({
          success: true,
          device_id: existing.id,
          device_name: authoritativeName,
          reconnected: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 새 기기 등록
    // ★ 이름 결정 우선순위: licenses.device_name > 요청 device_name > 기본값
    const finalName = licenseDeviceName || device_name || "My Device";

    // 기기명 중복 검사
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

    // licenses 테이블 upsert (device_name 포함)
    if (normalizedSerialKey) {
      await supabaseAdmin
        .from("licenses")
        .upsert(
          {
            serial_key: normalizedSerialKey,
            device_id: newDevice.id,
            user_id,
            is_active: true,
            device_name: finalName,
          },
          { onConflict: "serial_key" }
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        device_id: newDevice.id,
        device_name: finalName,
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
