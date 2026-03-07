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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "app_latest_version")
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ latest_version: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // value is stored as JSON string, strip quotes if needed
    let version = data.value;
    if (typeof version === "string" && version.startsWith('"')) {
      version = JSON.parse(version);
    }

    return new Response(
      JSON.stringify({ latest_version: version }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-app-version error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to check version" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
