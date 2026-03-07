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
    const { build_time } = await req.json();
    if (!build_time) {
      return new Response(
        JSON.stringify({ registered: false, reason: "no build_time" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read current latest version
    const { data: current } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "app_latest_version")
      .single();

    const currentVersion = current?.value as string | null;

    // Only update if new build_time is strictly newer (string comparison works for "YYYY-MM-DD HH:MM" format)
    if (!currentVersion || build_time > currentVersion) {
      await supabaseAdmin
        .from("system_settings")
        .upsert({ key: "app_latest_version", value: JSON.stringify(build_time) }, { onConflict: "key" });

      return new Response(
        JSON.stringify({ registered: true, version: build_time }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ registered: false, reason: "not_newer", current: currentVersion }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("register-app-version error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to register version" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
