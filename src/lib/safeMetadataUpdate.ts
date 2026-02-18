import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";

/**
 * DB에서 최신 metadata를 읽은 후 안전하게 병합하여 업데이트합니다.
 * Race condition으로 인한 설정값 덮어쓰기를 방지합니다.
 */
export async function safeMetadataUpdate(
  deviceId: string,
  updates: Record<string, unknown>,
  extraColumns?: Record<string, unknown>
): Promise<void> {
  // 1. DB에서 최신 metadata 읽기
  const { data, error: fetchError } = await supabase
    .from("devices")
    .select("metadata")
    .eq("id", deviceId)
    .maybeSingle();

  if (fetchError) throw fetchError;

  const currentMeta = (data?.metadata as Record<string, unknown>) || {};

  // 2. 안전하게 병합
  const merged = { ...currentMeta, ...updates };

  // 3. 업데이트
  const { error } = await supabase
    .from("devices")
    .update({
      metadata: merged as unknown as Json,
      ...(extraColumns || {}),
    })
    .eq("id", deviceId);

  if (error) throw error;
}
