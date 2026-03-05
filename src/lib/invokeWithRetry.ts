import { supabase } from "@/integrations/supabase/client";

/**
 * supabase.functions.invoke를 최대 maxRetries회 재시도합니다.
 * 502/503 같은 일시적 에러에 대해 지수 백오프로 재시도합니다.
 */
export async function invokeWithRetry(
  functionName: string,
  options: { body: Record<string, unknown> },
  maxRetries = 2
): Promise<{ data: unknown; error: unknown }> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke(functionName, options);

    if (!error) {
      return { data, error: null };
    }

    // HTML 응답(502/503 등)인지 확인
    const errorStr = typeof error === "object" && error !== null
      ? JSON.stringify(error)
      : String(error);
    const isTransient = errorStr.includes("502") || errorStr.includes("503") || errorStr.includes("Bad gateway");

    if (!isTransient || attempt === maxRetries) {
      return { data, error };
    }

    lastError = error;
    const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
    console.warn(`[invokeWithRetry] ${functionName} attempt ${attempt + 1} failed (transient), retrying in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }

  return { data: null, error: lastError };
}
