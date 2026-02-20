import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];

/** metadata.sort_order 기준으로 기기 정렬 (없으면 created_at 순) */
export function sortDevicesByOrder(devices: Device[]): Device[] {
  return [...devices].sort((a, b) => {
    const aOrder = ((a.metadata as Record<string, unknown>)?.sort_order as number) ?? Infinity;
    const bOrder = ((b.metadata as Record<string, unknown>)?.sort_order as number) ?? Infinity;
    if (aOrder !== Infinity || bOrder !== Infinity) return aOrder - bOrder;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/** 기기 순서를 변경하고 모든 기기의 sort_order를 metadata에 저장 */
export async function reorderDevices(
  devices: Device[],
  deviceId: string,
  direction: "up" | "down"
): Promise<Device[]> {
  const sorted = sortDevicesByOrder(devices);
  const idx = sorted.findIndex(d => d.id === deviceId);
  if (idx < 0) return sorted;

  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return sorted;

  // Swap
  const newOrder = [...sorted];
  [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];

  // Save sort_order to metadata for both swapped devices
  await Promise.all(
    newOrder.map((d, i) => safeMetadataUpdate(d.id, { sort_order: i }))
  );

  return newOrder;
}
