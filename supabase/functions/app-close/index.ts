import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, smartphone_device_id } = await req.json();

    if (!user_id || !smartphone_device_id) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. 스마트폰 오프라인 설정
    await supabase
      .from("devices")
      .update({ status: "offline" })
      .eq("id", smartphone_device_id)
      .eq("user_id", user_id);

    // 2. 모든 비-스마트폰 기기 감시 OFF
    await supabase
      .from("devices")
      .update({ is_monitoring: false })
      .eq("user_id", user_id)
      .neq("device_type", "smartphone");

    console.log(`[app-close] ✅ user=${user_id.slice(0, 8)} phone=${smartphone_device_id.slice(0, 8)} → offline + monitoring OFF`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[app-close] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
