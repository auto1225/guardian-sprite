import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Database } from "@/integrations/supabase/types";
import { deleteLaptopDbDevice } from "@/lib/laptopDb";
import { websiteSupabase } from "@/lib/websiteAuth";
import { invokeWithRetry } from "@/lib/invokeWithRetry";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

// ── 모듈 레벨 싱글톤: 사용자당 단일 Presence 채널 ──
let activeUserId: string | null = null;
let activeDbChannel: ReturnType<typeof supabase.channel> | null = null;
let activePresenceChannel: ReturnType<typeof supabase.channel> | null = null;
const activeLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const realtimeConfirmedOnline = new Set<string>();
const devicePresenceData = new Map<string, { is_network_connected?: boolean; is_camera_connected?: boolean }>();
// ★ serial_key → Presence 데이터 인덱스 (queryFn에서 cross-DB 매칭용)
const presenceBySerialKey = new Map<string, { is_network_connected?: boolean; is_camera_connected?: boolean; device_name?: string }>();
const devicePresenceNames = new Map<string, string>(); // Presence/Broadcast에서 확인된 최신 이름
// ★ Presence key → 공유 DB device ID 매핑 (leave→sync 경합 방지용)
const presenceKeyToDeviceId = new Map<string, string>();
const deviceChargingMap = new Map<string, boolean>(); // Presence-only: is_charging per deviceId
const cameraDbVerified = new Map<string, number>(); // DB에서 camera=true 확인된 시각 (30초간 Presence 무시)
// ★ 카메라 다운그레이드 grace period 타이머
const cameraDowngradeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// ★ 카메라 상태 DB 재검증 타이머 (Presence 온라인 확인 후 DB 값 교차 검증)
const cameraVerifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
let subscriberCount = 0;
let presenceInitialSynced = false; // ★ Presence 최초 sync 완료 여부

// ── 모듈 레벨 싱글톤: 기기 선택 상태 (모든 컴포넌트가 공유) ──
const SELECTED_DEVICE_STORAGE_KEY = "meercop_selected_device_id";
const SELECTED_SERIAL_STORAGE_KEY = "meercop_selected_serial_key";
let _selectedDeviceId: string | null = localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY);
let _selectedSerialKey: string | null = localStorage.getItem(SELECTED_SERIAL_STORAGE_KEY);
let _selectionInitialized = false;
const _selectionListeners = new Set<() => void>();

function getSelectedDeviceId() {
  return _selectedDeviceId;
}

function setGlobalSelectedDeviceId(id: string | null, serialKey?: string | null) {
  if (_selectedDeviceId === id) return;
  _selectedDeviceId = id;
  if (id) {
    localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(SELECTED_DEVICE_STORAGE_KEY);
  }
  // ★ 시리얼 키도 함께 저장 — 새로고침 시 ID가 바뀌어도 시리얼로 복원 가능
  if (serialKey !== undefined) {
    _selectedSerialKey = serialKey ?? null;
    if (serialKey) {
      localStorage.setItem(SELECTED_SERIAL_STORAGE_KEY, serialKey);
    } else {
      localStorage.removeItem(SELECTED_SERIAL_STORAGE_KEY);
    }
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
  devicePresenceNames.clear();
  presenceBySerialKey.clear();
  presenceKeyToDeviceId.clear();
  activeUserId = null;
  subscriberCount = 0;
  presenceInitialSynced = false;
}

export const useDevices = () => {
  const { user, effectiveUserId } = useAuth();
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading, error } = useQuery({
    queryKey: ["devices", effectiveUserId],
    placeholderData: (prev) => prev, // ★ 리패치 중 이전 데이터 유지 → 깜빡임 방지
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

      // ★ DB 조회 결과에 Presence 확인된 온라인 상태 보존 (이름은 DB 정본 사용)
      // Presence가 이미 sync된 상태라면, Presence에 없는 기기는 offline으로 강제 전환
      return dbDevices.map(d => {
        // 컨트롤러 스마트폰(시리얼 키 없는)만 스킵, 관리 대상 스마트폰은 Presence 처리
        if (d.device_type === "smartphone" && !(d.metadata as Record<string, unknown>)?.serial_key) return d;

        // ★ DB 이름을 정본(Single Source of Truth)으로 사용 — Presence 이름 무시
        const resolvedName = d.name;

        // ★ realtimeConfirmedOnline 매칭: 직접 ID 또는 serial_key 기반 폴백
        let isConfirmedOnline = realtimeConfirmedOnline.has(d.id);
        let presenceData = devicePresenceData.get(d.id);

        if (!isConfirmedOnline) {
          // serial_key로 Presence 데이터 탐색
          const deviceSerialKey = (d.metadata as Record<string, unknown>)?.serial_key as string | undefined;
          if (deviceSerialKey && presenceBySerialKey.has(deviceSerialKey)) {
            isConfirmedOnline = true;
            const serialData = presenceBySerialKey.get(deviceSerialKey)!;
            presenceData = { is_network_connected: serialData.is_network_connected, is_camera_connected: serialData.is_camera_connected };
            // 매칭된 기기 ID를 realtimeConfirmedOnline에 등록 (이후 sync에서도 사용)
            realtimeConfirmedOnline.add(d.id);
            devicePresenceData.set(d.id, presenceData);
            console.log("[useDevices] 🔑 Serial-key match in queryFn:", d.id.slice(0, 8), "serial:", deviceSerialKey);
          }
        }

        if (isConfirmedOnline) {
          // ★ DB 검증 후 30초간은 Presence의 camera=false를 무시
          const dbVerifiedAt = cameraDbVerified.get(d.id);
          const isDbCameraVerified = dbVerifiedAt && (Date.now() - dbVerifiedAt < 30000);
          let resolvedCamera = presenceData?.is_camera_connected ?? d.is_camera_connected;
          if (isDbCameraVerified && presenceData?.is_camera_connected === false) {
            resolvedCamera = true;
          }
          return {
            ...d,
            // ★ 이름은 항상 DB 값 사용 (Presence 이름 오염 방지)
            status: "online" as Device["status"],
            is_network_connected: presenceData?.is_network_connected ?? true,
            is_camera_connected: resolvedCamera,
          };
        }
        // ★ Presence가 sync 완료됐는데 이 기기가 Presence에 없으면 → DB heartbeat 폴백 확인
        if (presenceInitialSynced && d.status !== "offline") {
          const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
          const isRecentlyActive = Date.now() - lastSeen < 150 * 1000; // 150초 (2분 30초)
          if (isRecentlyActive) {
            console.log("[useDevices] 🟡 Not in Presence but DB active (", Math.round((Date.now() - lastSeen) / 1000), "s ago):", d.id.slice(0, 8), d.name);
            return d;
          }
          console.log("[useDevices] 🔴 Force offline (not in Presence, DB stale):", d.id.slice(0, 8), d.name);
          return {
            ...d,
            status: "offline" as Device["status"],
            is_network_connected: false,
            is_camera_connected: false,
          };
        }
        return d;
      });
    },
    enabled: !!effectiveUserId,
    refetchInterval: 10_000, // ★ 10초 주기 폴링: Realtime 누락 시에도 DB 상태 반영
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  // 전역 싱글톤 선택 상태 사용
  const selectedDeviceId = useSyncExternalStore(subscribeSelection, getSelectedDeviceId);
  const setSelectedDeviceId = useCallback((id: string | null) => {
    // 선택 시 해당 기기의 시리얼 키도 함께 저장
    const dev = devices.find(d => d.id === id);
    const serial = dev ? (dev.metadata as Record<string, unknown>)?.serial_key as string | undefined : undefined;
    setGlobalSelectedDeviceId(id, serial ?? null);
  }, [devices]);

  // ── 관리 대상 기기 목록: 컨트롤러(시리얼 키 없는 스마트폰)만 제외, sort_order 정렬 ──
  const managedDevices = devices.filter(d => {
    if (d.device_type !== "smartphone") return true;
    return !!(d.metadata as Record<string, unknown>)?.serial_key;
  }).sort((a, b) => {
    const aOrder = ((a.metadata as Record<string, unknown>)?.sort_order as number) ?? Infinity;
    const bOrder = ((b.metadata as Record<string, unknown>)?.sort_order as number) ?? Infinity;
    if (aOrder !== Infinity || bOrder !== Infinity) return aOrder - bOrder;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // ── 자동 선택: 동기적으로 유효한 기기를 선택 ──
  // useEffect 대신 렌더링 중 즉시 계산하여 "기기 연결 대기 중" 깜빡임 방지
  const resolvedDeviceId = (() => {
    // ★ useSyncExternalStore보다 모듈 변수를 직접 사용 (render 타이밍 불일치 방지)
    const savedId = _selectedDeviceId;
    const savedSerial = _selectedSerialKey || localStorage.getItem(SELECTED_SERIAL_STORAGE_KEY);

    // 1) 저장된 device ID로 직접 매칭
    if (savedId) {
      const found = managedDevices.find(d => d.id === savedId);
      if (found) return savedId;
    }
    // 2) device ID가 유효하지 않으면, 저장된 시리얼 키로 복원 시도
    if (savedSerial) {
      const bySerial = managedDevices.find(d => (d.metadata as Record<string, unknown>)?.serial_key === savedSerial);
      if (bySerial) return bySerial.id;
    }
    // 3) 현재 선택이 유효하지 않음 → 재선택 (sort_order 정렬된 목록에서 안정적 선택)
    const mainDevice = managedDevices.find(d => (d.metadata as Record<string, unknown>)?.is_main);
    const onlineDevice = managedDevices.find(d => d.status === "online" || d.status === "monitoring" || d.status === "alert");
    const target = mainDevice || onlineDevice || managedDevices[0];
    console.log("[useDevices] 🔄 Auto-select fallback:", { savedId: savedId?.slice(0, 8), savedSerial, picked: target?.id?.slice(0, 8), name: target?.name });
    return target?.id || null;
  })();

  // 전역 상태와 동기화 (비동기적으로, 다음 렌더링에 반영)
  useEffect(() => {
    if (resolvedDeviceId && resolvedDeviceId !== _selectedDeviceId) {
      console.log("[useDevices] Auto-selecting device:", resolvedDeviceId.slice(0, 8));
      const dev = managedDevices.find(d => d.id === resolvedDeviceId);
      const serial = dev ? (dev.metadata as Record<string, unknown>)?.serial_key as string | undefined : undefined;
      setGlobalSelectedDeviceId(resolvedDeviceId, serial ?? null);
      _selectionInitialized = true;
    }
  }, [resolvedDeviceId, managedDevices]);

  const selectedDevice = devices.find((d) => d.id === resolvedDeviceId) || null;

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
      const { data, error } = await invokeWithRetry("update-device", {
        body: { device_id: id, ...updates },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      // ★ 로컬 캐시 즉시 업데이트 → invalidate 대신 setQueryData로 깜빡임 방지
      queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
        if (!old) return old;
        const { id, ...updates } = variables;
        return old.map(d => d.id === id ? { ...d, ...updates } : d);
      });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      // 삭제 전에 기기의 serial_key를 확보 (노트북 DB 동기화용)
      const currentDevices = queryClient.getQueryData<Device[]>(["devices", effectiveUserId]);
      const targetDevice = currentDevices?.find(d => d.id === id);
      const serialKey = (targetDevice?.metadata as Record<string, unknown>)?.serial_key as string | undefined;

      // 1) 공유 DB에서 삭제
      const { error } = await invokeWithRetry("update-device", {
        body: { device_id: id, _action: "delete" },
      });
      if (error) throw error;

      // 2) 노트북 로컬 DB에서도 삭제 (serial_key 기반, fire-and-forget)
      if (serialKey && effectiveUserId) {
        deleteLaptopDbDevice(serialKey, effectiveUserId).catch(err =>
          console.warn("[DeleteSync] Laptop DB delete failed:", err)
        );
      }
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
            // 컨트롤러 스마트폰만 무시, 관리 대상 스마트폰은 처리
            if (updatedDevice.device_type === "smartphone" && !(updatedDevice.metadata as Record<string, unknown>)?.serial_key) return;
            if (updatedDevice.status === "online") realtimeConfirmedOnline.add(updatedDevice.id);
            else if (updatedDevice.status === "offline") realtimeConfirmedOnline.delete(updatedDevice.id);
            console.log("[Realtime] Device updated:", { id: updatedDevice.id, status: updatedDevice.status });
            queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
              if (!oldDevices) return oldDevices;
              return oldDevices.map((device) => {
                if (device.id !== updatedDevice.id) return device;
                // ★ 이름이 이미 동일하고 주요 필드에 변화가 없으면 동일 참조 유지 (깜빡임 방지)
                // ★ DB 이름을 정본으로 사용 — Presence 이름 무시
                const effectiveName = updatedDevice.name;
                if (
                  device.name === effectiveName &&
                  device.status === updatedDevice.status &&
                  device.is_monitoring === updatedDevice.is_monitoring &&
                  device.is_network_connected === updatedDevice.is_network_connected &&
                  device.is_camera_connected === (updatedDevice.is_camera_connected ?? device.is_camera_connected) &&
                  device.battery_level === updatedDevice.battery_level
                ) {
                  return device; // 동일 참조 반환 → React.memo가 리렌더 스킵
                }
                return { ...device, ...updatedDevice, name: effectiveName, is_camera_connected: updatedDevice.is_camera_connected ?? device.is_camera_connected };
              });
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
        const wasAlreadySynced = presenceInitialSynced;
        presenceInitialSynced = true; // ★ Presence 최초 sync 완료
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
          serial_key?: string;
          device_name?: string;
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

        // ★ Presence sync 시 DB에 stale online인 기기 추적 → DB 동기화
        const forcedOfflineIds: string[] = [];

        // ★ oldDevices 존재 여부와 무관하게, Presence에서 온라인 기기 ID를 미리 수집
        // (queryFn이 나중에 실행될 때 realtimeConfirmedOnline을 참조할 수 있도록)
        presenceBySerialKey.clear();
        for (const entry of allPresenceEntries) {
          if (entry.data.status === 'online') {
            // device_id가 있으면 직접 등록
            if (entry.data.device_id) {
              realtimeConfirmedOnline.add(entry.data.device_id);
              devicePresenceData.set(entry.data.device_id, {
                is_network_connected: entry.data.is_network_connected,
                is_camera_connected: entry.data.is_camera_connected,
              });
              if (entry.data.device_name) {
                devicePresenceNames.set(entry.data.device_id, entry.data.device_name);
              }
            }
            // Presence key 자체도 등록 (직접 매칭용)
            realtimeConfirmedOnline.add(entry.key);
            devicePresenceData.set(entry.key, {
              is_network_connected: entry.data.is_network_connected,
              is_camera_connected: entry.data.is_camera_connected,
            });
            // ★ serial_key 인덱스 등록 (queryFn에서 cross-DB 매칭용)
            if (entry.data.serial_key) {
              presenceBySerialKey.set(entry.data.serial_key, {
                is_network_connected: entry.data.is_network_connected,
                is_camera_connected: entry.data.is_camera_connected,
                device_name: entry.data.device_name,
              });
            }
          }
        }

        queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
          if (!oldDevices) {
            // ★ 쿼리가 아직 완료되지 않음 → invalidate로 재실행 트리거
            if (!wasAlreadySynced) {
              console.log("[Presence] ⏳ Query not ready yet, will invalidate after query completes");
              setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
              }, 100);
            }
            return oldDevices;
          }

          // 매칭된 Presence 키 추적 (중복 매칭 방지)
          const matchedKeys = new Set<string>();

          return oldDevices.map((d) => {
            // 컨트롤러 스마트폰(시리얼 키 없는)만 스킵, 관리 대상 스마트폰은 Presence 처리
            if (d.device_type === "smartphone" && !(d.metadata as Record<string, unknown>)?.serial_key) return d;

            // 1) 공유 DB ID로 직접 매칭 (Presence key === 공유 DB device ID)
            let match = allPresenceEntries.find(e => e.key === d.id && !matchedKeys.has(e.key));

            // 2) Presence 데이터의 device_id 필드로 매칭
            if (!match) {
              match = allPresenceEntries.find(e =>
                !matchedKeys.has(e.key) &&
                e.data.device_id === d.id
              );
            }

            // 3) serial_key 기반 매칭
            if (!match) {
              const deviceSerialKey = (d.metadata as Record<string, unknown>)?.serial_key as string | undefined;
              if (deviceSerialKey) {
                match = allPresenceEntries.find(e =>
                  !matchedKeys.has(e.key) &&
                  (e.data as Record<string, unknown>)?.serial_key === deviceSerialKey
                );
                if (match) {
                  console.log("[Presence] 🔑 Serial-key match:", d.id.slice(0, 8), "←", match.key.slice(0, 8), "serial:", deviceSerialKey);
                }
              }
            }

            // 4) 최후 폴백: 1:1 매칭만 허용
            if (!match) {
              const knownDeviceIds = new Set(oldDevices.map(od => od.id));
              const unmatchedPresence = allPresenceEntries.filter(e =>
                !matchedKeys.has(e.key) &&
                !knownDeviceIds.has(e.key) &&
                e.data.status === 'online'
              );
              const unmatchedDevices = oldDevices.filter(od =>
                od.device_type !== 'smartphone' &&
                !allPresenceEntries.some(e => e.key === od.id || e.data.device_id === od.id) &&
                !matchedKeys.has(od.id)
              );
              if (unmatchedPresence.length === 1 && unmatchedDevices.length === 1 && unmatchedDevices[0].id === d.id) {
                match = unmatchedPresence[0];
                console.log("[Presence] 🔄 1:1 fallback match:", d.id.slice(0, 8), "←", match.key.slice(0, 8));
              }
            }

            if (!match) {
              // ★ Presence에 없는 비-스마트폰 기기 → DB heartbeat 폴백 확인
              if (d.status !== "offline") {
                // ★ 활성 grace timer가 있으면 offline 강제 전환하지 않음 (leave→sync 경합 방지)
                const hasActiveGraceTimer = Array.from(activeLeaveTimers.keys()).some(timerKey => {
                  // 직접 매칭: timer key === device ID
                  if (timerKey === d.id) return true;
                  // cross-DB 매칭: 이전에 이 device에 매핑된 Presence key의 leave timer 확인
                  return presenceKeyToDeviceId.get(timerKey) === d.id;
                });

                if (hasActiveGraceTimer) {
                  console.log("[Presence] ⏳ Grace timer active, skipping offline for:", d.id.slice(0, 8), d.name);
                  return d;
                }

                const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
                const isRecentlyActive = Date.now() - lastSeen < 5 * 60 * 1000;
                if (isRecentlyActive) {
                  // DB가 최근 활동 → offline 강제 전환 안 함
                  console.log("[Presence] 🟡 No Presence match but DB active (", Math.round((Date.now() - lastSeen) / 1000), "s ago):", d.id.slice(0, 8), d.name);
                  return d;
                }
                console.log("[Presence] 🔴 No match in Presence, DB stale → forcing offline:", d.id.slice(0, 8), d.name);
                realtimeConfirmedOnline.delete(d.id);
                devicePresenceData.delete(d.id);
                forcedOfflineIds.push(d.id);
                return {
                  ...d,
                  status: "offline" as Device["status"],
                  is_network_connected: false,
                  is_camera_connected: false,
                };
              }
              return d;
            }
            // ★ 매칭된 Presence key → 공유 DB ID 매핑 기록
            presenceKeyToDeviceId.set(match.key, d.id);
            matchedKeys.add(match.key);

            const latest = match.data;
            const newStatus = latest.status === 'online' ? 'online' : 'offline';
            if (newStatus === 'online') realtimeConfirmedOnline.add(d.id);
            else realtimeConfirmedOnline.delete(d.id);

            if (latest.is_charging !== undefined) {
              deviceChargingMap.set(d.id, latest.is_charging);
            }
            devicePresenceData.set(d.id, {
              is_network_connected: latest.is_network_connected,
              is_camera_connected: latest.is_camera_connected,
            });

            // ★ DB에서 camera=true 확인 후 30초간은 Presence의 camera=false를 무시
            const dbVerifiedAt = cameraDbVerified.get(d.id);
            const isDbVerifiedRecent = dbVerifiedAt && (Date.now() - dbVerifiedAt < 30000);

            // ★ Presence에서 온라인인데 카메라 상태가 undefined/false → DB 재검증 예약
            if (newStatus === 'online' && !latest.is_camera_connected && !isDbVerifiedRecent && !cameraVerifyTimers.has(d.id)) {
              const verifyTimer = setTimeout(async () => {
                cameraVerifyTimers.delete(d.id);
                try {
                  const { data } = await supabase.functions.invoke("get-devices", {
                    body: { device_id: d.id },
                  });
                  const dbDevice = data?.devices?.[0];
                  if (dbDevice?.is_camera_connected === true) {
                    console.log("[Presence] 🔄 Camera verified via DB for", d.id.slice(0, 8));
                    cameraDbVerified.set(d.id, Date.now()); // 30초간 Presence camera=false 무시
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
            if (latest.is_camera_connected === true) {
              if (cameraVerifyTimers.has(d.id)) {
                clearTimeout(cameraVerifyTimers.get(d.id)!);
                cameraVerifyTimers.delete(d.id);
              }
              // Presence가 직접 camera=true 보고 → DB 검증 플래그 갱신
              cameraDbVerified.set(d.id, Date.now());
            }

            // ★ 카메라 true→false: 5초 grace period (DB 검증 후 30초간은 무시)
            let resolvedCameraConnected = latest.is_camera_connected ?? d.is_camera_connected;
            if (isDbVerifiedRecent && latest.is_camera_connected === false) {
              // DB에서 최근 camera=true 확인 → Presence의 false 무시
              resolvedCameraConnected = true;
            } else if (latest.is_camera_connected === false && d.is_camera_connected === true) {
              if (!cameraDowngradeTimers.has(d.id)) {
                console.log("[Presence] ⏳ Camera downgrade grace period started for", d.id.slice(0, 8));
                const timer = setTimeout(() => {
                  cameraDowngradeTimers.delete(d.id);
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
              resolvedCameraConnected = true;
            } else if (latest.is_camera_connected === true) {
              const existingTimer = cameraDowngradeTimers.get(d.id);
              if (existingTimer) {
                clearTimeout(existingTimer);
                cameraDowngradeTimers.delete(d.id);
                console.log("[Presence] ✅ Camera downgrade cancelled for", d.id.slice(0, 8));
              }
            }

            // ★ Presence의 device_name은 상태 확인용으로만 사용, UI 이름은 DB 정본 유지
            const hasChanges = d.is_network_connected !== latest.is_network_connected || d.is_camera_connected !== resolvedCameraConnected || d.status !== newStatus || (latest.battery_level !== undefined && d.battery_level !== latest.battery_level);
            if (!hasChanges) return d;

            console.log("[Presence] ✅ Updating:", d.id.slice(0, 8), "←", match.key.slice(0, 8), { status: `${d.status}→${newStatus}`, camera: `${d.is_camera_connected}→${resolvedCameraConnected}` });
            const updatedMeta = newStatus === 'online'
              ? { ...((d.metadata as Record<string, unknown>) || {}), logged_out: false }
              : d.metadata;
            return {
              ...d,
              // ★ 이름은 DB 값 유지 — Presence name으로 덮어쓰지 않음
              status: newStatus as Device["status"],
              is_network_connected: latest.is_network_connected ?? d.is_network_connected,
              is_camera_connected: resolvedCameraConnected,
              battery_level: latest.battery_level ?? d.battery_level,
              metadata: updatedMeta,
            };
          });
        });

        // ★ Presence에서 강제 오프라인된 기기들의 DB 상태도 동기화 (best-effort)
        for (const deviceId of forcedOfflineIds) {
          invokeWithRetry("update-device", {
            body: { device_id: deviceId, status: "offline", is_network_connected: false, is_camera_connected: false },
          }).catch(() => { /* best effort */ });
        }
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        const timer = activeLeaveTimers.get(key);
        if (timer) { clearTimeout(timer); activeLeaveTimers.delete(key); }
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        const existingTimer = activeLeaveTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        const currentDevices = queryClient.getQueryData<Device[]>(["devices", effectiveUserId]);
        const isDirectMatch = currentDevices?.some(d => d.id === key);

        // Cross-DB leave: leaving key의 serial_key로 공유 DB 기기 매칭
        let crossMatchedDeviceId: string | null = null;
        if (!isDirectMatch && currentDevices) {
          const leftData = (leftPresences as Array<Record<string, unknown>>)?.[0];
          const leftSerial = leftData?.serial_key as string | undefined;
          if (leftSerial) {
            const matched = currentDevices.find(d =>
              d.device_type !== 'smartphone' &&
              (d.metadata as Record<string, unknown>)?.serial_key === leftSerial
            );
            if (matched) crossMatchedDeviceId = matched.id;
          }
        }

        // ★ 즉시 offline 처리하지 않고, grace period 후에 판정
        // Presence가 불안정하게 leave/join을 반복하므로, 즉시 전환하면 UI 깜빡임 발생
        const targetId = isDirectMatch ? key : crossMatchedDeviceId;
        if (targetId) {
          console.log("[Presence] ⏳ Device leave detected:", key.slice(0, 8), targetId === key ? "(direct)" : `(cross→${targetId.slice(0, 8)})`, "→ grace period 8s");
        } else {
          console.log("[Presence] ⏳ Device left (unmatched):", key.slice(0, 8), "→ waiting 8s");
        }

        const timer = setTimeout(() => {
          activeLeaveTimers.delete(key);
          const state = activePresenceChannel?.presenceState() || {};
          const stillPresent = Object.keys(state).includes(key);
          // ★ serial_key로도 재확인 (key가 다르지만 같은 기기가 다시 접속한 경우)
          let stillPresentBySerial = false;
          if (targetId && !stillPresent) {
            const latestDevices = queryClient.getQueryData<Device[]>(["devices", effectiveUserId]);
            const targetDevice = latestDevices?.find(d => d.id === targetId);
            const serialKey = (targetDevice?.metadata as Record<string, unknown>)?.serial_key as string | undefined;
            if (serialKey) {
              for (const [, entries] of Object.entries(state)) {
                const typedEntries = entries as Array<Record<string, unknown>>;
                if (typedEntries?.some(e => e.serial_key === serialKey)) {
                  stillPresentBySerial = true;
                  break;
                }
              }
            }
          }

          if (!stillPresent && !stillPresentBySerial) {
            if (targetId) {
              realtimeConfirmedOnline.delete(targetId);
              devicePresenceData.delete(targetId);
              // 카메라 grace period 타이머도 정리
              const camTimer = cameraDowngradeTimers.get(targetId);
              if (camTimer) { clearTimeout(camTimer); cameraDowngradeTimers.delete(targetId); }
              const verifyTimer = cameraVerifyTimers.get(targetId);
              if (verifyTimer) { clearTimeout(verifyTimer); cameraVerifyTimers.delete(targetId); }

              queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
                if (!oldDevices) return oldDevices;
                return oldDevices.map((d) =>
                  d.id === targetId
                    ? { ...d, status: 'offline' as Device["status"], is_network_connected: false, is_camera_connected: false }
                    : d
                );
              });
              console.log("[Presence] 🔴 Device confirmed offline after grace:", targetId.slice(0, 8));
            } else {
              // 매칭 실패했던 leave: Presence에 아무도 없으면 전체 비-스마트폰 offline
              const remainingKeys = Object.keys(state);
              if (remainingKeys.length === 0) {
                currentDevices?.forEach(d => {
                  if (d.device_type !== "smartphone") {
                    realtimeConfirmedOnline.delete(d.id);
                    devicePresenceData.delete(d.id);
                  }
                });
              }
            }
            queryClient.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
          } else {
            console.log("[Presence] ✅ Device still present after grace period:", key.slice(0, 8), "→ staying online");
          }
        }, 8000);
        activeLeaveTimers.set(key, timer);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.error("[Presence] Channel error");
      });

    // ── name_changed 브로드캐스트 수신: 노트북에서 이름 변경 시 즉시 반영 ──
    const cmdChannelName = `user-commands-${effectiveUserId}`;
    const nameChangedHandler = ({ payload }: { payload: any }) => {
      console.log("[useDevices] 📝 name_changed received:", payload);
      const newName = payload?.new_name || payload?.name;
      if (!newName) return;

      // ★ serial_key 기반 매칭 우선 (노트북의 device_id 매핑 오류 방지)
      const serialKey = payload?.serial_key;
      const rawDeviceId = payload?.target_shared_device_id || payload?.device_id;
      const currentDevices = queryClient.getQueryData<Device[]>(["devices", effectiveUserId]);

      let targetDevice: Device | undefined;
      if (serialKey && currentDevices) {
        targetDevice = currentDevices.find(d =>
          (d.metadata as Record<string, unknown>)?.serial_key === serialKey
        );
        if (targetDevice) {
          console.log("[useDevices] 🔑 name_changed matched by serial_key:", serialKey, "→", targetDevice.id.slice(0, 8));
        }
      }
      if (!targetDevice && rawDeviceId && currentDevices) {
        targetDevice = currentDevices.find(d => d.id === rawDeviceId);
      }

      const deviceId = targetDevice?.id || rawDeviceId;
      if (!deviceId) return;

      console.log("[useDevices] ✅ Applying name change:", deviceId.slice(0, 8), "→", newName);
      // ★ 모듈 레벨 캐시에 저장 (DB 재조회 시에도 이름 보존)
      devicePresenceNames.set(deviceId, newName);
      // 로컬 캐시 즉시 업데이트 (DB 재조회 없이)
      queryClient.setQueryData(["devices", effectiveUserId], (oldDevices: Device[] | undefined) => {
        if (!oldDevices) return oldDevices;
        return oldDevices.map(d => d.id === deviceId ? { ...d, name: newName } : d);
      });
      // ★ 공유 DB에도 이름 반영 (노트북이 공유 DB를 업데이트하지 못했을 수 있음)
      invokeWithRetry("update-device", {
        body: { device_id: deviceId, updates: { name: newName } },
      }).then(({ error }) => {
        if (error) console.warn("[useDevices] ⚠️ Failed to sync name to shared DB:", error);
        else console.log("[useDevices] ✅ Name synced to shared DB:", deviceId, "→", newName);
      }).catch(() => { /* best effort */ });

      // ★ 웹사이트 DB의 serial_numbers.device_name도 동기화
      const resolvedSerial = serialKey || (targetDevice?.metadata as Record<string, unknown>)?.serial_key as string | undefined;
      if (resolvedSerial) {
        websiteSupabase
          .from("serial_numbers")
          .update({ device_name: newName })
          .eq("serial_key", resolvedSerial)
          .then(({ error }) => {
            if (error) console.warn("[useDevices] ⚠️ Website DB name sync failed:", error);
            else console.log("[useDevices] ✅ Website DB name synced:", resolvedSerial, "→", newName);
          });
      }
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
    selectedDeviceId: resolvedDeviceId,
    setSelectedDeviceId,
    addDevice,
    updateDevice,
    deleteDevice,
    refreshDeviceStatus,
    getDeviceCharging,
  };
};
