import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const body = await req.json();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (body.action === "insert") {
    const { error } = await supabase.from("webrtc_signaling").insert(body.record);
    return new Response(JSON.stringify({ success: !error, error: error?.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "delete") {
    let query = supabase.from("webrtc_signaling").delete().eq("device_id", body.device_id);
    if (body.sender_type) query = query.eq("sender_type", body.sender_type);
    const { error } = await query;
    return new Response(JSON.stringify({ success: !error, error: error?.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
