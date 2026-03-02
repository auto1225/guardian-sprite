// 랩탑 프로젝트 DB (dmvbwyfzueywuwxkjuuy) 공유 상수
export const LAPTOP_DB_URL = "https://dmvbwyfzueywuwxkjuuy.supabase.co";
export const LAPTOP_DB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtdmJ3eWZ6dWV5d3V3eGtqdXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTI2ODMsImV4cCI6MjA4NTg2ODY4M30.0lDX72JHWonW5fRRPve_cdfJrNVyDMzz5nzshJ0cEuI";

/**
 * 랩탑 로컬 DB에서 기기 삭제 (serial_key 기반 매칭)
 * 공유 DB의 device ID와 노트북 DB의 device ID가 다르므로 serial_key로 찾아서 삭제
 */
export async function deleteLaptopDbDevice(serialKey: string, userId: string): Promise<void> {
  try {
    // 1) 먼저 serial_key로 노트북 DB의 기기를 조회
    const searchRes = await fetch(
      `${LAPTOP_DB_URL}/rest/v1/devices?select=id&metadata->>serial_key=eq.${serialKey}&user_id=eq.${userId}`,
      {
        headers: {
          apikey: LAPTOP_DB_ANON_KEY,
          Authorization: `Bearer ${LAPTOP_DB_ANON_KEY}`,
        },
      }
    );
    
    if (!searchRes.ok) {
      console.warn("[LaptopDB] Device search failed:", await searchRes.text());
      return;
    }
    
    const devices = await searchRes.json();
    if (!devices || devices.length === 0) {
      console.log("[LaptopDB] No matching device found for serial:", serialKey);
      return;
    }

    // 2) 찾은 기기를 삭제
    for (const device of devices) {
      const deleteRes = await fetch(
        `${LAPTOP_DB_URL}/rest/v1/devices?id=eq.${device.id}`,
        {
          method: "DELETE",
          headers: {
            apikey: LAPTOP_DB_ANON_KEY,
            Authorization: `Bearer ${LAPTOP_DB_ANON_KEY}`,
          },
        }
      );
      
      if (deleteRes.ok) {
        console.log("[LaptopDB] ✅ Device deleted:", device.id.slice(0, 8));
      } else {
        console.warn("[LaptopDB] ⚠️ Delete failed:", await deleteRes.text());
      }
    }
  } catch (err) {
    console.warn("[LaptopDB] ⚠️ Cross-DB delete error:", err);
  }
}
