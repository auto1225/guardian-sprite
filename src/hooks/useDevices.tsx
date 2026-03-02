import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Database } from "@/integrations/supabase/types";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

// ── 모듈 레벨 싱글톤: 사용자당 단일 Presence 채널 ──
let activeUserId: string | null = null;
let activeDbChannel: ReturnType<typeof supabase.channel> | null = null;
let activePresenceChannel: ReturnType<typeof supabase.channel> | null = null;
const activeLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const realtimeConfirmedOnline = new Set<string>();
const devicePresenceData = new Map<string, { is_network_connected?: boolean; is_camera_connected?: boolean }>();
const deviceChargingMap = new Map<string, boolean>(); // Presence-only: is_charging per deviceId
// ★ 카메라 다운그레이드 grace period 타이머
const cameraDowngradeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// ★ 카메라 상태 DB 재검증 타이머 (Presence 온라인 확인 후 DB 값 교차 검증)
const cameraVerifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
let subscriberCount = 0;

// ── 모듈 레벨 싱글톤: 기기 선택 상태 (모든 컴포넌트가 공유) ──
const SELECTED_DEVICE_STORAGE_KEY = "meercop_selected_device_id";
let _selectedDeviceId: string | null = localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY);
let _selectionInitialized = false;
const _selectionListeners = new Set<() => void>();

function getSelectedDeviceId() {
  return _selectedDeviceId;
}

function setGlobalSelectedDeviceId(id: string | null) {
  if (_selectedDeviceId === id) return;
  _selectedDeviceId = id;
  // ★ localStorage에 저장하여 새로고침 후에도 유지
  if (id) {
    localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(SELECTED_DEVICE_STORAGE_KEY);
  }
  _selectionListeners.forEach(l => l());
}

function subscribeSelection(listener: () => void) {
  _selectionListeners.add(listener);
  return () => { _selectionListeners.delete(listener); };
}

function cleanupAllChannels() {
  activeLeaveTimers.forEach((timer) => clearTimeout(timer));
  activeLeaveTimers.clear();
  cameraDowngradeTimers.forEach((timer) => clearTimeout(timer));
  cameraDowngradeTimers.clear();
  cameraVerifyTimers.forEach((timer) => clearTimeout(timer));
  cameraVerifyTimers.clear();
  if (activeDbChannel) {
    supabase.removeChannel(activeDbChannel);
    activeDbChannel = null;
  }
  if (activePresenceChannel) {
    supabase.removeChannel(activePresenceChannel);
    activePresenceChannel = null;
  }
  realtimeConfirmedOnline.clear();
  activeUserId = null;
  subscriberCount = 0;
}

export const useDevices = () => {
  const { user, effectiveUserId } = useAuth();
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading, error } = useQuery({
    queryKey: ["devices", effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) return [];
      
      // 항상 Edge Function 사용 (effectiveUserId 기반, RLS 우회)
      console.log("[useDevices] Fetching devices for userId:", effectiveUserId);
      const { data, error } = await supabase.functions.invoke("get-devices", {
        body: { user_id: effectiveUserId },
      });
      if (error) {
        console.error("[useDevices] get-devices error:", error);
        throw error;
      }
      if (data?.error) {
        console.error("[useDevices] get-devices data error:", data.error);
        throw new Error(data.error);
      }
      const dbDevices = (data?.devices || []) as Device[];
      console.log("[useDevices] Fetched", dbDevices.length, "devices:", dbDevices.map(d => ({ id: d.id.slice(0, 8), name: d.name, type: d.device_type, status: d.status })));

      // ★ DB 조회 결과에 Presence 확인된 온라인 상태 보존
      // DB는 랩탑의 공유DB 업데이트가 실패하면 항상 offline을 반환하므로
      // Presence로 확인된 online 상태를 덮어쓰지 않도록 함
      return dbDevices.map(d => {
        if (d.device_type === "smartphone") return d;
        if (realtimeConfirmedOnline.has(d.id)) {
          const presenceData = devicePresenceData.get(d.id);
          return {
            ...d,
            status: "online" as Device["status"],
            // Presence 확인된 온라인 기기: 네트워크는 반드시 연결, 카메라는 Presence 데이터 우선
            is_network_connected: presenceData?.is_network_connected ?? true,
            is_camera_connected: presenceData?.is_camera_connected ?? d.is_camera_connected,
          };
        }
        return d;
      });
    },
    enabled: !!effectiveUserId,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  // 전역 싱글톤 선택 상태 사용
  const selectedDeviceId = useSyncExternalStore(subscribeSelection, getSelectedDeviceId);
  const setSelectedDeviceId = useCallback((id: string | null) => {
    setGlobalSelectedDeviceId(id);
  }, []);

  // 자동 선택: 유효한 기기가 선택되지 않았을 때만
  useEffect(() => {
    if (devices.length === 0) return;
    const nonSmartphones = devices.filter(d => d.device_type !== "smartphone");
    
    if (_selectedDeviceId) {
      const currentDevice = nonSmartphones.find(d => d.id === _selectedDeviceId);
      if (currentDevice) {
        _selectionInitialized = true;
        return;
      }
    }
    
    if (!_selectionInitialized || !_selectedDeviceId) {
      const mainDevice = nonSmartphones.find(d => (d.metadata as Record<string, unknown>)?.is_main);
      // online 기기 우선 선택
      const onlineDevice = nonSmartphones.find(d => d.status === "online" || d.status === "monitoring" || d.status === "alert");
      const target = mainDevice || onlineDevice || nonSmartphones[0];
      if (target) {
        setGlobalSelectedDeviceId(target.id);
        _selectionInitialized = true;
      }
    }
  }, [devices]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;

  const addDevice = useMutation({
    mutationFn: async (device: Omit<DeviceInsert, "user_id">) => {
      if (!effectiveUserId) throw new Error("Not authenticated");
      if (user) {
        const { data, error } = await supabase
          .from("devices")
          .insert({ ...device, user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      // 시리얼 인증 시 Edge Function 필요 (향후 구현)
      throw new Error("Device creation requires auth session");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const updateDevice = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Device>) => {
      const { data, error } = await supabase.functions.invoke("update-device", {
        body: { device_id: id, ...updates },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke("update-device", {
        body: { device_id: id, _action: "delete" },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    },
  });

  const refreshDeviceStatus = async (deviceId?: string) => {
    if (!effectiveUserId) return;
    try {
      // Edge Function을 통해 기기 상태 새로고침
      const { data, error } = await supabase.functions.invoke("get-devices", {
        body: { user_id: effectiveUserId, device_id: deviceId },
      });
      if (error) { console.error("[Devices] Refresh error:", error); return; }
      const devices = data?.devices || [];
      if (devices.length > 0) {
        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return devices;
          return oldDevices.map((device) => {
            const updated = devices.find((d: Device) => d.id === device.id);
            return updated ? { ...device, ...updated } : device;
          });
        });
      }
    } catch (err) {
      console.error("[Devices] Refresh failed:", err);
    }
  };

  // ── Realtime 구독: 사용자당 단일 Presence 채널 ──
  useEffect(() => {
    if (!effectiveUserId) return;

    subscriberCount++;

    // 이미 같은 유저로 설정되어 있으면 스킵
    if (activeUserId === effectiveUserId) {
      return () => {
        subscriberCount--;
        if (subscriberCount <= 0) cleanupAllChannels();
      };
    }

    if (activeUserId && activeUserId !== effectiveUserId) cleanupAllChannels();
    activeUserId = effectiveUserId;

    // ── DB 변경 감지 채널 ──
    const dbChannelName = `devices-db-${effectiveUserId}`;
    const existingDbCh = supabase.getChannels().find(ch => ch.topic === `realtime:${dbChannelName}`);
    if (existingDbCh) {
      supabase.removeChannel(existingDbCh);
    }

    activeDbChannel = supabase
        .channel(dbChannelName, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            const updatedDevice = payload.new as Device;
            if (updatedDevice.device_type === "smartphone") return;
            if (updatedDevice.status === "online") realtimeConfirmedOnline.add(updatedDevice.id);
            else if (updatedDevice.status === "offline") realtimeConfirmedOnline.delete(updatedDevice.id);
            console.log("[Realtime] Device updated:", { id: updatedDevice.id, status: updatedDevice.status });
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.map((device) =>
                device.id === updatedDevice.id
                  ? { ...device, ...updatedDevice, is_camera_connected: updatedDevice.is_camera_connected ?? device.is_camera_connected }
                  : device
              );
            });
          }
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return [payload.new as Device];
              return [...oldDevices, payload.new as Device];
            });
          }
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "devices", filter: `user_id=eq.${effectiveUserId}` },
          (payload) => {
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.filter((device) => device.id !== (payload.old as Device).id);
            });
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") console.error("[Realtime] DB channel error");
        });

    // ── 단일 Presence 채널: user-presence-{userId} ──
    const presenceChannelName = `user-presence-${effectiveUserId}`;
    const existingPresence = supabase.getChannels().find(ch => ch.topic === `realtime:${presenceChannelName}`);
    if (existingPresence) supabase.removeChannel(existingPresence);

    activePresenceChannel = supabase.channel(presenceChannelName);

    activePresenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = activePresenceChannel!.presenceState();

        // 모든 Presence 항목을 수집 (키는 랩탑 로컬 DB ID일 수 있음)
        type PresenceEntry = {
          device_id?: string;
          status?: string;
          is_network_connected?: boolean;
          is_camera_connected?: boolean;
          battery_level?: number;
          is_charging?: boolean;
          last_seen_at?: string;
        };
        const allPresenceEntries: Array<{ key: string; data: PresenceEntry }> = [];
        for (const [key, entries] of Object.entries(state)) {
          const typedEntries = entries as PresenceEntry[];
          if (!typedEntries || typedEntries.length === 0) continue;
          const latest = typedEntries.reduce((a, b) => {
            const aT = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
            const bT = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
            return bT > aT ? b : a;
          });
          allPresenceEntries.push({ key, data: latest });
        }

        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) return oldDevices;

          // 매칭된 Presence 키 추적 (중복 매칭 방지)
          const matchedKeys = new Set<string>();

          return oldDevices.map((d) => {
            if (d.device_type === "smartphone") return d;

            // 1) 공유 DB ID로 직접 매칭
            let match = allPresenceEntries.find(e => e.key === d.id && !matchedKeys.has(e.key));

            // 2) 직접 매칭 실패 → 미매칭된 Presence 항목 중 랩탑 후보 찾기
            //    (랩탑은 로컬 DB ID를 Presence 키로 사용하므로 공유 DB ID와 다름)
            if (!match) {
              const knownDeviceIds = new Set(oldDevices.map(od => od.id));
              match = allPresenceEntries.find(e =>
                !matchedKeys.has(e.key) &&
                !knownDeviceIds.has(e.key) &&
                e.data.status === 'online'
              );
            }

            if (!match) return d;
            matchedKeys.add(match.key);

            const latest = match.data;
            const newStatus = latest.status === 'online' ? 'online' : 'offline';
            if (newStatus === 'online') realtimeConfirmedOnline.add(d.id);
            else realtimeConfirmedOnline.delete(d.id);

            if (latest.is_charging !== undefined) {
              deviceChargingMap.set(d.id, latest.is_charging);
            }
            // Presence 데이터 저장
            devicePresenceData.set(d.id, {
              is_network_connected: latest.is_network_connected,
              is_camera_connected: latest.is_camera_connected,
            });

            // ★ Presence에서 온라인인데 카메라 상태가 undefined/false → DB 재검증 예약
            if (newStatus === 'online' && !latest.is_camera_connected && !cameraVerifyTimers.has(d.id)) {
              const verifyTimer = setTimeout(async () => {
                cameraVerifyTimers.delete(d.id);
                try {
                  const { data } = await supabase.functions.invoke("get-devices", {
                    body: { device_id: d.id },
                  });
                  const dbDevice = data?.devices?.[0];
                  if (dbDevice?.is_camera_connected === true) {
                    console.log("[Presence] 🔄 Camera verified via DB for", d.id.slice(0, 8));
                    devicePresenceData.set(d.id, {
                      ...devicePresenceData.get(d.id),
                      is_camera_connected: true,
                    });
                    queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
                      if (!old) return old;
                      return old.map(dev => dev.id === d.id ? { ...dev, is_camera_connected: true } : dev);
                    });
                  }
                } catch { /* best effort */ }
              }, 3000);
              cameraVerifyTimers.set(d.id, verifyTimer);
            }
            // 카메라가 true로 확인되면 검증 타이머 취소
            if (latest.is_camera_connected === true && cameraVerifyTimers.has(d.id)) {
              clearTimeout(cameraVerifyTimers.get(d.id)!);
              cameraVerifyTimers.delete(d.id);
            }

            // ★ 카메라 true→false: 5초 grace period (노트북 새로고침 시 일시적 false 방지)
            // false→true 또는 변화 없음: 즉시 반영 & 기존 타이머 취소
            let resolvedCameraConnected = latest.is_camera_connected ?? d.is_camera_connected;
            if (latest.is_camera_connected === false && d.is_camera_connected === true) {
              // 이미 타이머가 없으면 생성, 있으면 기존 유지
              if (!cameraDowngradeTimers.has(d.id)) {
                console.log("[Presence] ⏳ Camera downgrade grace period started for", d.id.slice(0, 8));
                const timer = setTimeout(() => {
                  cameraDowngradeTimers.delete(d.id);
                  // 5초 후에도 Presence에서 여전히 false인지 확인
                  const currentPresence = devicePresenceData.get(d.id);
                  if (currentPresence?.is_camera_connected === false) {
                    console.log("[Presence] 📷 Camera downgrade confirmed for", d.id.slice(0, 8));
                    queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
                      if (!old) return old;
                      return old.map(dev => dev.id === d.id ? { ...dev, is_camera_connected: false } : dev);
                    });
                  }
                }, 5000);
                cameraDowngradeTimers.set(d.id, timer);
              }
              resolvedCameraConnected = true; // grace period 동안 true 유지
            } else if (latest.is_camera_connected === true) {
              // true로 복귀 → 타이머 취소
              const existingTimer = cameraDowngradeTimers.get(d.id);
              if (existingTimer) {
                clearTimeout(existingTimer);
                cameraDowngradeTimers.delete(d.id);
                console.log("[Presence] ✅ Camera downgrade cancelled for", d.id.slice(0, 8));
              }
            }

            const hasChanges = d.is_network_connected !== latest.is_network_connected || d.is_camera_connected !== resolvedCameraConnected || d.status !== newStatus || (latest.battery_level !== undefined && d.battery_level !== latest.battery_level);
            if (!hasChanges) return d;

            console.log("[Presence] ✅ Updating:", d.id.slice(0, 8), "←", match.key.slice(0, 8), { status: `${d.status}→${newStatus}`, camera: `${d.is_camera_connected}→${resolvedCameraConnected}` });
            const updatedMeta = newStatus === 'online'
              ? { ...((d.metadata as Record<string, unknown>) || {}), logged_out: false }
              : d.metadata;
            return {
              ...d,
              status: newStatus as Device["status"],
              is_network_connected: latest.is_network_connected ?? d.is_network_connected,
              is_camera_connected: resolvedCameraConnected,
              battery_level: latest.battery_level ?? d.battery_level,
              metadata: updatedMeta,
            };
          });
        });
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        const timer = activeLeaveTimers.get(key);
        if (timer) { clearTimeout(timer); activeLeaveTimers.delete(key); }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        const existingTimer = activeLeaveTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        // 직접 ID 매칭 여부 확인
        const currentDevices = queryClient.getQueryData<Device[]>(["devices", effectiveUserId]);
        const isDirectMatch = currentDevices?.some(d => d.id === key);

        if (isDirectMatch) {
          // 직접 매칭: 즉시 offline 처리
          realtimeConfirmedOnline.delete(key);
          devicePresenceData.delete(key);
          queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
            if (!oldDevices) return oldDevices;
            return oldDevices.map((d) =>
              d.id === key
                ? { ...d, status: 'offline' as Device["status"], is_network_connected: false, is_camera_connected: false }
                : d
            );
          });
          console.log("[Presence] 🔴 Device left (direct):", key.slice(0, 8), "→ offline");
        } else {
          console.log("[Presence] ⏳ Device left (cross-DB):", key.slice(0, 8), "→ waiting 8s before offline");
        }

        const timer = setTimeout(() => {
          activeLeaveTimers.delete(key);
          // Presence 재확인: 아직 없으면 offline 처리
          const state = activePresenceChannel?.presenceState() || {};
          const stillPresent = Object.keys(state).includes(key);
          if (!stillPresent) {
            if (!isDirectMatch) {
              // 크로스 DB 매칭: 해당 키에 매칭된 기기만 offline 처리 (모든 기기를 제거하지 않음)
              // Presence에 남아있는 다른 키가 있는지 확인
              const remainingPresenceKeys = Object.keys(state);
              const knownDeviceIds = new Set(currentDevices?.map(d => d.id) || []);
              
              // 현재 Presence에 아무 항목도 없는 경우에만 해당 랩탑을 offline으로 전환
              const hasAnyLaptopPresence = remainingPresenceKeys.some(k => 
                !knownDeviceIds.has(k) || currentDevices?.some(d => d.id === k && d.device_type !== 'smartphone')
              );
              
              if (!hasAnyLaptopPresence) {
                // 랩탑 Presence가 완전히 사라짐 → 해당 랩탑만 offline
                currentDevices?.forEach(d => {
                  if (d.device_type !== "smartphone") {
                    realtimeConfirmedOnline.delete(d.id);
                    devicePresenceData.delete(d.id);
                  }
                });
              }
            }
            queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
          }
        }, isDirectMatch ? 3000 : 8000);
        activeLeaveTimers.set(key, timer);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.error("[Presence] Channel error");
      });

    // ── name_changed 브로드캐스트 수신: 노트북에서 이름 변경 시 즉시 반영 ──
    const cmdChannelName = `user-commands-${effectiveUserId}`;
    const nameChangedHandler = ({ payload }: { payload: any }) => {
      console.log("[useDevices] 📝 name_changed received:", payload);
      // 노트북 페이로드: target_shared_device_id + new_name (또는 device_id + name 호환)
      const deviceId = payload?.target_shared_device_id || payload?.device_id;
      const newName = payload?.new_name || payload?.name;
      if (!deviceId || !newName) return;
      console.log("[useDevices] ✅ Applying name change:", deviceId, "→", newName);
      queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
        if (!oldDevices) return oldDevices;
        return oldDevices.map(d => d.id === deviceId ? { ...d, name: newName } : d);
      });
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    };
    const existingCmdCh = supabase.getChannels().find(ch => ch.topic === `realtime:${cmdChannelName}`);
    const cmdChannel = existingCmdCh || supabase.channel(cmdChannelName);
    // 기존 채널이든 새 채널이든 리스너를 항상 등록
    cmdChannel.on("broadcast", { event: "name_changed" }, nameChangedHandler);

    // ── device_logout 브로드캐스트 수신: 노트북 로그아웃 시 즉시 오프라인 처리 ──
    const deviceLogoutHandler = ({ payload }: { payload: any }) => {
      console.log("[useDevices] 🔴 device_logout received:", payload);
      const deviceId = payload?.device_id;
      if (!deviceId) return;
      // 로컬 캐시 즉시 업데이트: offline + 감시/스트리밍 해제
      queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
        if (!oldDevices) return oldDevices;
        return oldDevices.map(d => d.id === deviceId ? {
          ...d,
          status: "offline" as const,
          is_monitoring: false,
          is_streaming_requested: false,
          is_camera_connected: false,
          is_network_connected: false,
          metadata: { ...((d.metadata as Record<string, unknown>) || {}), logged_out: true },
        } : d);
      });
      // DB에서도 최신 데이터 가져오기
      queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
      console.log("[useDevices] ✅ Device", deviceId, "set to offline due to logout");
    };
    cmdChannel.on("broadcast", { event: "device_logout" }, deviceLogoutHandler);

    if (!existingCmdCh) {
      cmdChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[useDevices] ✅ user-commands channel subscribed for name_changed + device_logout");
        }
      });
    }

    // ── 네트워크 복구 시 채널 재연결 ──
    const handleReconnect = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const name = detail?.name;
      if (name === dbChannelName || name === presenceChannelName) {
        console.log("[useDevices] ♻️ Reconnecting channel:", name);
        cleanupAllChannels();
        activeUserId = null;
        queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
      }
    };
    window.addEventListener('channelmanager:reconnect', handleReconnect);

    return () => {
      subscriberCount--;
      if (subscriberCount <= 0) cleanupAllChannels();
      window.removeEventListener('channelmanager:reconnect', handleReconnect);
    };
  }, [effectiveUserId, queryClient]);

  const getDeviceCharging = useCallback((deviceId: string): boolean => {
    return deviceChargingMap.get(deviceId) ?? false;
  }, []);

  return {
    devices,
    isLoading,
    error,
    selectedDevice,
    selectedDeviceId,
    setSelectedDeviceId,
    addDevice,
    updateDevice,
    deleteDevice,
    refreshDeviceStatus,
    getDeviceCharging,
  };
};
