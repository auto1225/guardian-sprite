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
    const { device_id, user_id } = await req.json();

    if (!device_id || !user_id) {
      return new Response(JSON.stringify({ error: "device_id and user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Set smartphone to offline
    await supabaseAdmin
      .from("devices")
      .update({ status: "offline", last_seen_at: new Date().toISOString() })
      .eq("id", device_id)
      .eq("user_id", user_id);

    // 2. Turn off monitoring for all non-smartphone devices
    await supabaseAdmin
      .from("devices")
      .update({ is_monitoring: false })
      .eq("user_id", user_id)
      .neq("device_type", "smartphone");

    console.log(`[app-close] ✅ Device ${device_id.slice(0, 8)} offline, monitoring OFF for user ${user_id.slice(0, 8)}`);

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
