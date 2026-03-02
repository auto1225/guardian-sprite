import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function queryWithRetry(supabaseAdmin: ReturnType<typeof createClient>, userId?: string, deviceId?: string, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let query = supabaseAdmin
        .from("devices")
        .select("*")
        .order("created_at", { ascending: true });

      if (userId) query = query.eq("user_id", userId);
      if (deviceId) query = query.eq("id", deviceId);

      const { data, error } = await query;

      if (error) {
        // Check for transient errors (502, connection issues)
        const msg = typeof error.message === "string" ? error.message : "";
        if (attempt < retries && (msg.includes("502") || msg.includes("Bad gateway") || msg.includes("fetch failed"))) {
          console.warn(`[get-devices] Attempt ${attempt}/${retries} failed (transient), retrying in ${attempt * 500}ms...`);
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
        throw error;
      }

      return data;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`[get-devices] Attempt ${attempt}/${retries} threw, retrying...`);
        await new Promise(r => setTimeout(r, attempt * 500));
        continue;
      }
      throw err;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, device_id } = await req.json();

    if (!user_id && !device_id) {
      return new Response(
        JSON.stringify({ error: "user_id or device_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const data = await queryWithRetry(supabaseAdmin, user_id, device_id);

    return new Response(
      JSON.stringify({ devices: data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-devices error:", err);
    return new Response(
      JSON.stringify({ error: "기기 조회에 실패했습니다." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
