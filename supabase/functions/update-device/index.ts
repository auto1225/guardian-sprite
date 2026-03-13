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
    const body = await req.json();
    const device_id = body.device_id;
    const action = body._action;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 삭제 액션 지원
    if (action === "delete") {
      if (!device_id) {
        return new Response(
          JSON.stringify({ error: "device_id required for delete" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // 라이선스의 device_id만 해제 (시리얼은 유지)
      await supabase
        .from("licenses")
        .update({ device_id: null })
        .eq("device_id", device_id);

      const { error } = await supabase.from("devices").delete().eq("id", device_id);
      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ deleted: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Support both { device_id, updates: {...} } and { device_id, field1, field2, ... }
    const updates = body.updates || (() => {
      const { device_id: _, _action: _a, ...rest } = body;
      return Object.keys(rest).length > 0 ? rest : null;
    })();

    if (!device_id || !updates) {
      return new Response(
        JSON.stringify({ error: "device_id and updates required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ★ 기기명 중복 검사 (같은 user_id 내에서 동일 이름의 다른 기기가 있는지)
    if (updates.name) {
      const { data: currentDevice } = await supabase
        .from("devices")
        .select("user_id, name, metadata")
        .eq("id", device_id)
        .single();

      // 이름이 실제로 변경되는 경우에만 중복 검사
      if (currentDevice && updates.name !== currentDevice.name) {
        const { data: dupDevice } = await supabase
          .from("devices")
          .select("id")
          .eq("user_id", currentDevice.user_id)
          .eq("name", updates.name)
          .neq("id", device_id)
          .limit(1)
          .maybeSingle();

        if (dupDevice) {
          return new Response(
            JSON.stringify({ error: "DUPLICATE_DEVICE_NAME", message: `기기명 '${updates.name}'은(는) 이미 사용 중입니다.` }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ★ 기기명 변경 시 licenses.device_name도 동기화 (SSOT)
      if (currentDevice && updates.name !== currentDevice.name) {
        const serialKey = (currentDevice.metadata as Record<string, unknown>)?.serial_key as string | undefined;
        if (serialKey) {
          await supabase
            .from("licenses")
            .update({ device_name: updates.name })
            .eq("serial_key", serialKey);
          console.log(`[update-device] 📛 licenses.device_name synced: "${currentDevice.name}" → "${updates.name}" for serial ${serialKey}`);
        }
      }
    }

    // ★ metadata 안전 병합: 기존 metadata를 읽어서 새 값과 병합
    if (updates.metadata && typeof updates.metadata === "object") {
      const { data: existing } = await supabase
        .from("devices")
        .select("metadata")
        .eq("id", device_id)
        .single();

      const existingMeta = (existing?.metadata as Record<string, unknown>) || {};
      updates.metadata = { ...existingMeta, ...updates.metadata };
    }

    const { data, error } = await supabase
      .from("devices")
      .update(updates)
      .eq("id", device_id)
      .select()
      .single();

    if (error) {
      console.error("update-device error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ★ 감시 ON/OFF 변경 시 서버에서 직접 푸시 알림 전송
    if (data && "is_monitoring" in updates) {
      const deviceName = data.name || "기기";
      const userId = data.user_id;
      const enable = updates.is_monitoring;
      const pushTitle = enable
        ? `🟢 ${deviceName} 감시 시작`
        : `🔴 ${deviceName} 감시 종료`;
      const pushBody = enable
        ? `${deviceName}에 감시를 시작합니다.`
        : `${deviceName}에 감시를 종료합니다.`;

      // 비동기로 푸시 전송 (응답 지연 방지)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      
      fetch(`${supabaseUrl}/functions/v1/push-notifications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          action: "send-server",
          user_id: userId,
          device_id,
          device_name: deviceName,
          title: pushTitle,
          body: pushBody,
          tag: `meercop-monitoring-${device_id}`,
        }),
      }).catch((err) => {
        console.warn("[update-device] Monitoring push failed:", err);
      });
    }

    return new Response(
      JSON.stringify({ updated: data ? 1 : 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("update-device error:", err);
    return new Response(
      JSON.stringify({ error: "서버 오류가 발생했습니다." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
