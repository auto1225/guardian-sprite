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

    // ★ metadata 안전 병합: 기존 metadata를 읽어서 새 값과 병합
    // 이렇게 하면 heartbeat가 network_info만 보내도 alarm_pin 등이 보존됨
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
      .select();

    if (error) {
      console.error("update-device error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ updated: data?.length ?? 0 }),
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
