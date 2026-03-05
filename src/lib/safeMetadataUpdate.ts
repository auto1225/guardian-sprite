import { supabase } from "@/integrations/supabase/client";
import { invokeWithRetry } from "@/lib/invokeWithRetry";

/**
 * DB에서 최신 metadata를 읽은 후 안전하게 병합하여 업데이트합니다.
 * Race condition으로 인한 설정값 덮어쓰기를 방지합니다.
 * Edge Function을 통해 RLS를 우회합니다 (시리얼 인증 호환).
 */
export async function safeMetadataUpdate(
  deviceId: string,
  updates: Record<string, unknown>,
  extraColumns?: Record<string, unknown>
): Promise<void> {
  // 1. Edge Function으로 현재 기기 데이터 조회
  const { data: deviceData, error: fetchError } = await supabase.functions.invoke("get-devices", {
    body: { device_id: deviceId },
  });

  if (fetchError) throw fetchError;

  const devices = deviceData?.devices || [];
  const device = devices.find((d: { id: string }) => d.id === deviceId);
  const currentMeta = (device?.metadata as Record<string, unknown>) || {};

  // 2. 안전하게 병합
  const merged = { ...currentMeta, ...updates };

  // 3. Edge Function으로 업데이트 (RLS 우회, 재시도 포함)
  const { error } = await invokeWithRetry("update-device", {
    body: {
      device_id: deviceId,
      metadata: merged,
      ...(extraColumns || {}),
    },
  });

  if (error) throw error;
}
