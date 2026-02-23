import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * monitor-heartbeat — 서버 사이드 하트비트 감시
 * 
 * pg_cron에서 2분마다 호출됨.
 * 
 * 동작:
 * 1. 감시 중(is_monitoring=true)인 노트북이 5분 이상 하트비트 없으면 → 오프라인 처리
 * 2. 해당 사용자에게 Push 경고 발송 ("노트북이 응답하지 않습니다")
 * 3. 스마트폰이 10분 이상 하트비트 없으면 → 오프라인 처리 + 감시 OFF
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    // ── 1. 5분 이상 무응답인 모든 비-스마트폰 기기 → offline 처리 ──
    const { data: staleDevices } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, name, status, is_monitoring, last_seen_at")
      .neq("device_type", "smartphone")
      .neq("status", "offline")
      .lt("last_seen_at", fiveMinAgo);

    if (staleDevices && staleDevices.length > 0) {
      console.log(`[monitor-heartbeat] Found ${staleDevices.length} stale device(s)`);

      for (const device of staleDevices) {
        await supabaseAdmin
          .from("devices")
          .update({ status: "offline", is_monitoring: false, is_network_connected: false, is_camera_connected: false })
          .eq("id", device.id);

        console.log(`[monitor-heartbeat] ⚫ Device ${device.id.slice(0, 8)} (${device.name}) → offline`);

        // 감시 중이었던 기기만 Push 경고
        if (device.is_monitoring) {
          await sendWarningPush(supabaseAdmin, device.user_id, device.name, device.id);
        }
      }
    }

    // ── 2. 스마트폰이 10분 이상 무응답 → 오프라인 + 소유 기기 감시 OFF ──
    const { data: stalePhones } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, status")
      .eq("device_type", "smartphone")
      .eq("status", "online")
      .lt("last_seen_at", tenMinAgo);

    if (stalePhones && stalePhones.length > 0) {
      for (const phone of stalePhones) {
        await supabaseAdmin
          .from("devices")
          .update({ status: "offline" })
          .eq("id", phone.id);

        // 해당 사용자의 모든 기기 감시 OFF
        await supabaseAdmin
          .from("devices")
          .update({ is_monitoring: false })
          .eq("user_id", phone.user_id)
          .neq("device_type", "smartphone");

        console.log(`[monitor-heartbeat] 📱 Smartphone ${phone.id.slice(0, 8)} → offline, monitoring OFF`);
      }
    }

    const result = {
      checked_at: now.toISOString(),
      stale_devices: staleDevices?.length ?? 0,
      stale_phones: stalePhones?.length ?? 0,
    };

    console.log("[monitor-heartbeat] ✅ Check complete:", result);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[monitor-heartbeat] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Push 경고 발송 헬퍼 ──
async function sendWarningPush(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  deviceName: string,
  deviceId: string
) {
  try {
    // push-notifications 함수를 내부에서 직접 호출하는 대신,
    // push_subscriptions에서 직접 구독 정보를 가져와서 전송
    // → 하지만 push-notifications의 암호화 로직이 복잡하므로
    //   간단히 DB에 alert 레코드를 삽입하여 기존 알림 파이프라인 활용
    const { error } = await supabaseAdmin
      .from("alerts")
      .insert({
        device_id: deviceId,
        alert_type: "offline",
        title: `⚠️ ${deviceName} 응답 없음`,
        message: `${deviceName}이(가) 5분 이상 응답하지 않습니다. 기기 상태를 확인해주세요.`,
        is_read: false,
      });

    if (error) {
      console.error("[monitor-heartbeat] Alert insert failed:", error);
    } else {
      console.log(`[monitor-heartbeat] 📨 Alert created for user ${userId.slice(0, 8)}`);
    }
  } catch (err) {
    console.error("[monitor-heartbeat] Push warning failed:", err);
  }
}
