import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const device_id = body.device_id as string | undefined;
    const action = body._action as string | undefined;
    const skipPush = body._skip_push === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 삭제 액션 지원
    if (action === "delete") {
      if (!device_id) {
        return new Response(
          JSON.stringify({ error: "device_id required for delete" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      // 라이선스의 device_id만 해제 (시리얼은 유지)
      await supabase
        .from("licenses")
        .update({ device_id: null })
        .eq("device_id", device_id);

      const { error } = await supabase.from("devices").delete().eq("id", device_id);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: jsonHeaders,
        });
      }

      return new Response(JSON.stringify({ deleted: true }), { headers: jsonHeaders });
    }

    // Support both { device_id, updates: {...} } and { device_id, field1, field2, ... }
    const updates =
      body.updates && typeof body.updates === "object"
        ? (body.updates as Record<string, unknown>)
        : (() => {
            const { device_id: _id, _action: _a, _skip_push: _sp, ...rest } = body;
            return Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : null;
          })();

    if (!device_id || !updates) {
      return new Response(JSON.stringify({ error: "device_id and updates required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const hasMonitoringUpdate = Object.prototype.hasOwnProperty.call(updates, "is_monitoring");
    const hasNameUpdate = typeof updates.name === "string";
    const hasMetadataUpdate = !!updates.metadata && typeof updates.metadata === "object";

    let currentDevice:
      | {
          user_id: string;
          name: string;
          metadata: Record<string, unknown> | null;
          is_monitoring: boolean;
        }
      | null = null;

    if (hasNameUpdate || hasMetadataUpdate || hasMonitoringUpdate) {
      const { data: current, error: currentError } = await supabase
        .from("devices")
        .select("user_id, name, metadata, is_monitoring")
        .eq("id", device_id)
        .single();

      if (currentError || !current) {
        return new Response(JSON.stringify({ error: "Device not found" }), {
          status: 404,
          headers: jsonHeaders,
        });
      }

      currentDevice = {
        user_id: current.user_id,
        name: current.name,
        metadata: (current.metadata as Record<string, unknown> | null) ?? null,
        is_monitoring: current.is_monitoring,
      };
    }

    // ★ 기기명 중복 검사 + licenses.device_name 동기화 (SSOT)
    if (hasNameUpdate && currentDevice && updates.name !== currentDevice.name) {
      const { data: dupDevice } = await supabase
        .from("devices")
        .select("id")
        .eq("user_id", currentDevice.user_id)
        .eq("name", String(updates.name))
        .neq("id", device_id)
        .limit(1)
        .maybeSingle();

      if (dupDevice) {
        return new Response(
          JSON.stringify({
            error: "DUPLICATE_DEVICE_NAME",
            message: `기기명 '${updates.name}'은(는) 이미 사용 중입니다.`,
          }),
          { status: 409, headers: jsonHeaders }
        );
      }

      const serialKey = currentDevice.metadata?.serial_key as string | undefined;
      if (serialKey) {
        await supabase
          .from("licenses")
          .update({ device_name: updates.name as string })
          .eq("serial_key", serialKey);

        console.log(
          `[update-device] 📛 licenses.device_name synced: "${currentDevice.name}" → "${updates.name}" for serial ${serialKey}`
        );
      }
    }

    // ★ metadata 안전 병합
    if (hasMetadataUpdate && currentDevice) {
      const existingMeta = currentDevice.metadata || {};
      updates.metadata = { ...existingMeta, ...(updates.metadata as Record<string, unknown>) };
    }

    const { data, error } = await supabase
      .from("devices")
      .update(updates)
      .eq("id", device_id)
      .select()
      .single();

    if (error) {
      console.error("update-device error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const monitoringChanged =
      hasMonitoringUpdate && currentDevice ? currentDevice.is_monitoring !== data.is_monitoring : false;

    // ★ 감시 ON/OFF가 실제로 바뀐 경우에만 서버 푸시 전송
    if (data && monitoringChanged && !skipPush) {
      const deviceName = data.name || "기기";
      const userId = data.user_id;
      const enable = data.is_monitoring;
      const pushTitle = enable ? `🟢 ${deviceName} 감시 시작` : `🔴 ${deviceName} 감시 종료`;
      const pushBody = enable
        ? `${deviceName}에 감시를 시작합니다.`
        : `${deviceName}에 감시를 종료합니다.`;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      try {
        const pushRes = await fetch(`${supabaseUrl}/functions/v1/push-notifications`, {
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
        });

        const pushResult = await pushRes.text();
        console.log(`[update-device] Monitoring push result: ${pushRes.status} ${pushResult}`);
      } catch (err) {
        console.warn("[update-device] Monitoring push failed:", err);
      }
    }

    return new Response(JSON.stringify({ updated: data ? 1 : 0 }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("update-device error:", err);
    return new Response(JSON.stringify({ error: "서버 오류가 발생했습니다." }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
