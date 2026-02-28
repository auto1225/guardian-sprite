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
    const { user_id, device_name, device_type } = await req.json();

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

    const effectiveType = device_type || "laptop";
    // laptop/desktop are treated as the same "computer" group to prevent duplicates
    const isComputerType = (t: string) => ["laptop", "desktop"].includes(t);
    const computerTypes = ["laptop", "desktop"];

    // 같은 user_id + device_type 그룹으로 이미 존재하는지 확인 (이름 무관 — 중복 방지)
    let existing: any = null;
    if (isComputerType(effectiveType)) {
      // 컴퓨터 그룹: laptop 또는 desktop 중 하나라도 있으면 재사용
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, name, device_type, status")
        .eq("user_id", user_id)
        .in("device_type", computerTypes)
        .limit(1)
        .maybeSingle();
      existing = data;
    } else {
      // smartphone, tablet 등: 정확한 타입 매칭
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
      await supabaseAdmin
        .from("devices")
        .update({
          status: "online",
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

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
    const { data: newDevice, error } = await supabaseAdmin
      .from("devices")
      .insert({
        user_id,
        name: device_name || "My Device",
        device_type: effectiveType,
        status: "online",
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("register-device insert error:", error);
      return new Response(
        JSON.stringify({ error: "기기 등록에 실패했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
