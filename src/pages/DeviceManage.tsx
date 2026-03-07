import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { ArrowLeft, MoreVertical, Crown, Star, Sparkles, CalendarDays, GripVertical, ChevronLeft, ChevronRight, ArrowUpDown, CheckSquare, Square, Monitor, Settings } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { useDevices } from "@/hooks/useDevices";
import { useCommands } from "@/hooks/useCommands";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { UserSerial } from "@/lib/websiteAuth";
import { supabase } from "@/integrations/supabase/client";
import { broadcastCommand } from "@/lib/broadcastCommand";
import LocationMapModal from "@/components/LocationMapModal";
import NetworkInfoModal from "@/components/NetworkInfoModal";
import CameraPage from "@/pages/Camera";
import SettingsPage from "@/pages/Settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import laptopOn from "@/assets/laptop-on.png";
import laptopOff from "@/assets/laptop-off.png";
import wifiOn from "@/assets/wifi-on.png";
import wifiOff from "@/assets/wifi-off.png";
import cameraOn from "@/assets/camera-on.png";
import cameraOff from "@/assets/camera-off.png";

type Device = Database["public"]["Tables"]["devices"]["Row"];
type SortMode = "default" | "alpha" | "number" | "plan" | "days" | "monitoring";

const ITEMS_PER_PAGE = 5;
const PLAN_ORDER: Record<string, number> = { premium: 0, basic: 1, free: 2 };
const PLAN_CONFIG: Record<string, { icon: typeof Crown; colorClass: string; bgClass: string }> = {
  free: { icon: Sparkles, colorClass: "text-emerald-300", bgClass: "bg-emerald-500/20 border-emerald-400/30" },
  basic: { icon: Star, colorClass: "text-blue-300", bgClass: "bg-blue-500/20 border-blue-400/30" },
  premium: { icon: Crown, colorClass: "text-amber-300", bgClass: "bg-amber-500/20 border-amber-400/30" },
};

interface DeviceManagePageProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
  onViewAlertHistory?: (deviceId: string) => void;
}

type MatchedItem = { serial: UserSerial | null; device: Device | null };

const DeviceManagePage = ({ isOpen, onClose, onSelectDevice, onViewAlertHistory }: DeviceManagePageProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, deleteDevice } = useDevices();
  const { serials, serialsLoading, effectiveUserId } = useAuth();
  const queryClient2 = useQueryClient();

  // 기기관리 페이지 열릴 때 최신 데이터 강제 리프레시
  useEffect(() => {
    if (isOpen && effectiveUserId) {
      queryClient2.invalidateQueries({ queryKey: ["devices", effectiveUserId] });
    }
  }, [isOpen, effectiveUserId]);
  const { toggleMonitoring } = useCommands();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try { return (localStorage.getItem("meercop_sort_mode") as SortMode) || "default"; } catch { return "default"; }
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [licenseMap, setLicenseMap] = useState<Map<string, { device_id: string; device_name: string | null }>>(new Map());
  const [iconPanel, setIconPanel] = useState<{ type: "locationMap" | "camera" | "networkInfo"; deviceId: string } | null>(null);
  const [settingsDeviceId, setSettingsDeviceId] = useState<string | null>(null);

  // ★ 시리얼별 번호를 localStorage에 저장
  const SERIAL_NUM_STORAGE_KEY = "meercop_serial_numbers";
  const getSerialNumbers = useCallback((): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem(SERIAL_NUM_STORAGE_KEY) || "{}");
    } catch { return {}; }
  }, []);
  const [serialNumbers, setSerialNumbers] = useState<Record<string, number>>(() => getSerialNumbers());

  // Drag state
  const dragState = useRef<{
    active: boolean;
    fromGlobalIdx: number;
    startY: number;
    currentOverIdx: number | null;
    crossPageTriggered: boolean;
  }>({ active: false, fromGlobalIdx: -1, startY: 0, currentOverIdx: null, crossPageTriggered: false });
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Swipe state
  const touchStartX = useRef(0);
  const swipeActive = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // ★ 컨트롤러(시리얼 키 없는 스마트폰)만 제외, 관리 대상 스마트폰은 포함
  const managedDevices = devices.filter(d => {
    if (d.device_type !== "smartphone") return true;
    // 시리얼 키가 있는 스마트폰은 관리 대상
    return !!(d.metadata as Record<string, unknown>)?.serial_key;
  });

  // Fetch licenses
  useEffect(() => {
    if (!effectiveUserId || serials.length === 0) return;
    const fetchLicenses = async () => {
      try {
        const serialKeys = serials.map(s => s.serial_key).filter(Boolean);
        if (serialKeys.length === 0) return;
        const { data: licData, error: licError } = await supabase
          .from("licenses")
          .select("serial_key, device_id, device_name")
          .in("serial_key", serialKeys);
        if (licError) return;
        const map = new Map<string, string>();
        for (const lic of (licData || [])) {
          if (lic.serial_key && lic.device_id) map.set(lic.serial_key, lic.device_id);
        }
        setLicenseMap(map);
      } catch {}
    };
    fetchLicenses();
  }, [effectiveUserId, serials]);

  // Match serials to devices
  const baseItems = useMemo(() => {
    const usedDeviceIds = new Set<string>();
    const result: MatchedItem[] = [];

    for (const serial of serials) {
      let matched = false;

      if (!matched && serial.serial_key) {
        const device = managedDevices.find(d =>
          !usedDeviceIds.has(d.id) &&
          (d.metadata as Record<string, unknown>)?.serial_key === serial.serial_key
        );
        if (device) { usedDeviceIds.add(device.id); result.push({ serial, device }); matched = true; }
      }

      if (!matched) {
        const linkedDeviceId = licenseMap.get(serial.serial_key);
        if (linkedDeviceId) {
          const device = managedDevices.find(d => d.id === linkedDeviceId && !usedDeviceIds.has(d.id));
          if (device) {
            const deviceSerial = (device.metadata as Record<string, unknown>)?.serial_key as string | undefined;
            // ★ 기기의 metadata.serial_key가 다른 시리얼이면 매칭 거부 (잘못된 크로스 매칭 방지)
            if (!deviceSerial || deviceSerial === serial.serial_key) {
              usedDeviceIds.add(device.id); result.push({ serial, device }); matched = true;
            }
          }
        }
      }

      if (!matched) result.push({ serial, device: null });
    }

    for (const device of managedDevices) {
      if (!usedDeviceIds.has(device.id)) result.push({ serial: null, device });
    }

    return result;
  }, [serials, managedDevices, licenseMap]);

  // ★ 정렬 결과를 DB에 sort_order로 영구 저장
  const persistSortOrder = useCallback(async (sortedItems: MatchedItem[]) => {
    const updatePromises = sortedItems
      .map((item, idx) => item.device ? safeMetadataUpdate(item.device.id, { sort_order: idx }) : null)
      .filter(Boolean);
    try {
      await Promise.all(updatePromises);
      queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
        if (!old) return old;
        return old.map(d => {
          const globalIdx = sortedItems.findIndex(ri => ri.device?.id === d.id);
          if (globalIdx >= 0) {
            return { ...d, metadata: { ...((d.metadata as Record<string, unknown>) || {}), sort_order: globalIdx } };
          }
          return d;
        });
      });
    } catch {
      console.error("[DeviceManage] Failed to save sort order");
    }
  }, [queryClient, effectiveUserId]);

  // Sort items: first apply sort mode, then custom drag order overrides
  const items = useMemo(() => {
    const sorted = [...baseItems];

    // Step 1: Apply sort mode
    if (sortMode === "alpha") {
      sorted.sort((a, b) => {
        const aName = a.device?.name || a.serial?.device_name || a.serial?.serial_key || "";
        const bName = b.device?.name || b.serial?.device_name || b.serial?.serial_key || "";
        return aName.localeCompare(bName);
      });
    } else if (sortMode === "number") {
      sorted.sort((a, b) => {
        const aKey = a.serial?.serial_key;
        const bKey = b.serial?.serial_key;
        const aNum = aKey ? serialNumbers[aKey] : undefined;
        const bNum = bKey ? serialNumbers[bKey] : undefined;
        return (aNum ?? Infinity) - (bNum ?? Infinity);
      });
    } else if (sortMode === "plan") {
      sorted.sort((a, b) => (PLAN_ORDER[a.serial?.plan_type || "free"] ?? 2) - (PLAN_ORDER[b.serial?.plan_type || "free"] ?? 2));
    } else if (sortMode === "days") {
      sorted.sort((a, b) => (a.serial?.remaining_days ?? 9999) - (b.serial?.remaining_days ?? 9999));
    } else if (sortMode === "monitoring") {
      sorted.sort((a, b) => (a.device?.is_monitoring ? 0 : 1) - (b.device?.is_monitoring ? 0 : 1));
    } else {
      sorted.sort((a, b) => {
        const aOrder = (a.device?.metadata as Record<string, unknown>)?.sort_order as number | undefined;
        const bOrder = (b.device?.metadata as Record<string, unknown>)?.sort_order as number | undefined;
        if (aOrder !== undefined || bOrder !== undefined) {
          return (aOrder ?? Infinity) - (bOrder ?? Infinity);
        }
        const aTime = a.device ? new Date(a.device.created_at).getTime() : Infinity;
        const bTime = b.device ? new Date(b.device.created_at).getTime() : Infinity;
        return aTime - bTime;
      });
    }

    // Step 2: If custom order exists (from drag), use it instead
    if (customOrder.length > 0) {
      sorted.sort((a, b) => {
        const aKey = a.serial?.serial_key || a.device?.id || "";
        const bKey = b.serial?.serial_key || b.device?.id || "";
        const aIdx = customOrder.indexOf(aKey);
        const bIdx = customOrder.indexOf(bKey);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    return sorted;
  }, [baseItems, sortMode, customOrder]);

  // ★ 정렬 모드 변경 시 sort_order를 DB에 저장
  const handleSortModeChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    setCustomOrder([]);
    localStorage.setItem("meercop_sort_mode", mode);
  }, []);

  // ★ items가 정렬 모드 변경으로 업데이트되면 DB에 저장
  const lastPersistedRef = useRef<string>("");
  useEffect(() => {
    if (items.length === 0) return;
    const key = items.map(i => itemKey(i)).join(",");
    if (key === lastPersistedRef.current) return;
    lastPersistedRef.current = key;
    // default 모드에서 customOrder 없을 때는 이미 DB 순서이므로 저장 불필요
    if (sortMode === "default" && customOrder.length === 0) return;
    persistSortOrder(items);
  }, [items, sortMode, customOrder]);

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const pageItems = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Item key helper
  const itemKey = (item: MatchedItem) => item.serial?.serial_key || item.device?.id || "";

  // Selection
  const toggleSelect = (key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectableItems = items.filter(i => i.device);
  const allSelected = selectableItems.length > 0 && selectableItems.every(i => selectedIds.has(itemKey(i)));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableItems.map(i => itemKey(i))));
    }
  };

  // Bulk monitoring
  const handleBulkMonitoring = async (enable: boolean) => {
    const targetDevices = items.filter(i => i.device && selectedIds.has(itemKey(i))).map(i => i.device!);
    for (const dev of targetDevices) {
      await toggleMonitoring(dev.id, enable);
    }
    setSelectedIds(new Set());
    toast({ title: t("deviceManage.bulkSuccess"), description: t("deviceManage.bulkSuccessDesc") });
  };

  // ─── Pointer-based drag reorder ─────────────────────────
  const handleDragPointerDown = (e: React.PointerEvent, localIdx: number) => {
    const globalIdx = (page - 1) * ITEMS_PER_PAGE + localIdx;
    dragState.current = { active: true, fromGlobalIdx: globalIdx, startY: e.clientY, currentOverIdx: localIdx, crossPageTriggered: false };
    setDragFromIdx(localIdx);
    setDragOverIdx(localIdx);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.active || !listRef.current) return;
    const rects = cardRefs.current.map(el => el?.getBoundingClientRect());
    const listRect = listRef.current.getBoundingClientRect();

    // ★ Cross-page detection: dragging above first card → previous page
    const firstRect = rects[0];
    if (firstRect && e.clientY < firstRect.top - 30 && page > 1 && !dragState.current.crossPageTriggered) {
      dragState.current.crossPageTriggered = true;
      // Move item to last position of previous page in global array
      const fromGlobal = dragState.current.fromGlobalIdx;
      const targetGlobal = (page - 2) * ITEMS_PER_PAGE + ITEMS_PER_PAGE - 1;
      if (fromGlobal !== targetGlobal) {
        const keys = items.map(i => itemKey(i));
        const [moved] = keys.splice(fromGlobal, 1);
        keys.splice(Math.min(targetGlobal, keys.length), 0, moved);
        setCustomOrder(keys);
        const reorderedItems = keys.map(k => items.find(i => itemKey(i) === k)).filter(Boolean) as MatchedItem[];
        persistSortOrder(reorderedItems);
      }
      // Navigate to previous page and end drag
      setPage(p => p - 1);
      dragState.current.active = false;
      setDragFromIdx(null);
      setDragOverIdx(null);
      return;
    }

    // ★ Cross-page detection: dragging below last card → next page
    const lastRect = rects[rects.length - 1];
    if (lastRect && e.clientY > lastRect.bottom + 30 && page < totalPages && !dragState.current.crossPageTriggered) {
      dragState.current.crossPageTriggered = true;
      const fromGlobal = dragState.current.fromGlobalIdx;
      const targetGlobal = page * ITEMS_PER_PAGE; // first position of next page
      if (fromGlobal !== targetGlobal) {
        const keys = items.map(i => itemKey(i));
        const [moved] = keys.splice(fromGlobal, 1);
        keys.splice(Math.min(targetGlobal, keys.length), 0, moved);
        setCustomOrder(keys);
        const reorderedItems = keys.map(k => items.find(i => itemKey(i) === k)).filter(Boolean) as MatchedItem[];
        persistSortOrder(reorderedItems);
      }
      setPage(p => p + 1);
      dragState.current.active = false;
      setDragFromIdx(null);
      setDragOverIdx(null);
      return;
    }

    // Normal within-page hover detection
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (dragState.current.currentOverIdx !== i) {
          dragState.current.currentOverIdx = i;
          setDragOverIdx(i);
        }
        break;
      }
    }
  }, [page, totalPages, items, itemKey, persistSortOrder]);

  const handleDragPointerUp = useCallback(async () => {
    if (!dragState.current.active) return;
    const fromLocal = dragFromIdx;
    const toLocal = dragState.current.currentOverIdx;
    dragState.current.active = false;

    if (fromLocal !== null && toLocal !== null && fromLocal !== toLocal) {
      const fromGlobal = (page - 1) * ITEMS_PER_PAGE + fromLocal;
      const toGlobal = (page - 1) * ITEMS_PER_PAGE + toLocal;
      const keys = items.map(i => itemKey(i));
      const [moved] = keys.splice(fromGlobal, 1);
      keys.splice(toGlobal, 0, moved);
      setCustomOrder(keys);

      // ★ DB에 sort_order 영구 저장
      const reorderedItems = keys.map(k => items.find(i => itemKey(i) === k)).filter(Boolean) as MatchedItem[];
      const updatePromises = reorderedItems
        .map((item, idx) => item.device ? safeMetadataUpdate(item.device.id, { sort_order: idx }) : null)
        .filter(Boolean);
      try {
        await Promise.all(updatePromises);
        // 로컬 캐시도 업데이트
        queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
          if (!old) return old;
          return old.map(d => {
            const globalIdx = reorderedItems.findIndex(ri => ri.device?.id === d.id);
            if (globalIdx >= 0) {
              return { ...d, metadata: { ...((d.metadata as Record<string, unknown>) || {}), sort_order: globalIdx } };
            }
            return d;
          });
        });
      } catch {
        console.error("[DeviceManage] Failed to save sort order");
      }
    }
    setDragFromIdx(null);
    setDragOverIdx(null);
  }, [dragFromIdx, page, items, itemKey, queryClient, effectiveUserId]);

  // Swipe for pagination (horizontal only, avoid conflict with drag)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    swipeActive.current = true;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!swipeActive.current) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 80) {
      if (dx < 0 && page < totalPages) setPage(p => p + 1);
      if (dx > 0 && page > 1) setPage(p => p - 1);
    }
    swipeActive.current = false;
  };

  // Actions
  const handleSetAsMain = async (deviceId: string) => {
    try {
      for (const d of managedDevices) {
        if ((d.metadata as Record<string, unknown>)?.is_main) {
          await safeMetadataUpdate(d.id, { is_main: false });
        }
      }
      await safeMetadataUpdate(deviceId, { is_main: true });
      setSelectedDeviceId(deviceId);
      onSelectDevice(deviceId);
      // ★ 로컬 캐시 즉시 업데이트 → 깜빡임 방지
      queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
        if (!old) return old;
        return old.map(d => {
          const meta = (d.metadata as Record<string, unknown>) || {};
          if (d.id === deviceId) return { ...d, metadata: { ...meta, is_main: true } };
          if (meta.is_main) return { ...d, metadata: { ...meta, is_main: false } };
          return d;
        });
      });
      toast({ title: t("deviceManage.mainDevice"), description: t("deviceManage.mainDeviceDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("deviceManage.mainDeviceFailed"), variant: "destructive" });
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      await deleteDevice.mutateAsync(deviceId);
      toast({ title: t("deviceManage.deviceDeleted"), description: t("deviceManage.deviceDeletedDesc") });
    } catch {
      toast({ title: t("common.error"), description: t("deviceManage.deviceDeleteFailed"), variant: "destructive" });
    }
  };

  const handleCamouflageToggle = async (deviceId: string) => {
    const device = managedDevices.find(d => d.id === deviceId);
    if (!device) return;
    const currentMeta = (device.metadata as Record<string, unknown>) || {};
    const newVal = !currentMeta.camouflage_mode;
    try {
      await safeMetadataUpdate(deviceId, { camouflage_mode: newVal });
      queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
        if (!old) return old;
        return old.map(d =>
          d.id === deviceId
            ? { ...d, metadata: { ...((d.metadata as Record<string, unknown>) || {}), camouflage_mode: newVal } }
            : d
        );
      });
      if (effectiveUserId) {
        await broadcastCommand({
          userId: effectiveUserId,
          event: "camouflage_toggle",
          payload: { device_id: deviceId, camouflage_mode: newVal },
          targetDeviceId: deviceId,
        });
      }
      toast({
        title: newVal ? t("camouflage.onTitle") : t("camouflage.offTitle"),
        description: newVal ? t("camouflage.onDesc") : t("camouflage.offDesc"),
      });
    } catch {
      toast({ title: t("common.error"), description: t("camouflage.changeFailed"), variant: "destructive" });
    }
  };

  const handleSaveNumber = (serialKey: string, num: number | null) => {
    setSerialNumbers(prev => {
      const next = { ...prev };
      if (num === null) { delete next[serialKey]; } else { next[serialKey] = num; }
      localStorage.setItem(SERIAL_NUM_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleIconClick = useCallback((deviceId: string, type: "laptop" | "network" | "camera") => {
    const device = managedDevices.find(d => d.id === deviceId);
    if (!device) return;
    if (device.status === "offline") {
      toast({
        title: t("status.deviceOffline"),
        description: t("status.deviceOfflineActionDesc", "컴퓨터가 로그아웃 또는 오프라인 상태이므로 연결할 수 없습니다."),
      });
      return;
    }
    const panelType = type === "laptop" ? "locationMap" : type === "camera" ? "camera" : "networkInfo";
    setIconPanel({ type: panelType, deviceId });
  }, [managedDevices, toast, t]);

  if (!isOpen) return null;

  const SORT_OPTIONS: { mode: SortMode; label: string }[] = [
    { mode: "default", label: "Default" },
    { mode: "alpha", label: t("deviceManage.sortAlpha") },
    { mode: "number", label: t("deviceManage.sortNumber") },
    { mode: "plan", label: t("deviceManage.sortPlan") },
    { mode: "days", label: t("deviceManage.sortDays") },
    { mode: "monitoring", label: t("deviceManage.sortMonitoring") },
  ];

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div className="flex items-center">
          <button onClick={onClose} className="text-primary-foreground mr-3">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-primary-foreground font-bold text-lg">{t("deviceManage.title")}</h1>
        </div>

        {/* Sort dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-primary-foreground/80 px-2 py-1 rounded-lg bg-white/10 text-xs font-medium">
              <ArrowUpDown className="w-3.5 h-3.5" />
              {SORT_OPTIONS.find(s => s.mode === sortMode)?.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-primary/90 backdrop-blur-xl border border-white/25 z-[100]">
            {SORT_OPTIONS.map(opt => (
              <DropdownMenuItem
                key={opt.mode}
                onClick={() => handleSortModeChange(opt.mode)}
                className={`text-primary-foreground focus:bg-white/15 focus:text-primary-foreground ${sortMode === opt.mode ? "bg-white/10" : ""}`}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Select All bar */}
      {selectableItems.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <button onClick={toggleSelectAll} className="flex items-center gap-2 text-primary-foreground/80 text-sm font-medium">
            {allSelected ? <CheckSquare className="w-4 h-4 text-secondary" /> : <Square className="w-4 h-4" />}
            {allSelected ? t("deviceManage.deselectAll") : t("deviceManage.selectAll")}
          </button>
          {selectedIds.size > 0 && (
            <span className="text-primary-foreground/60 text-xs">{selectedIds.size}{t("deviceManage.selected")}</span>
          )}
        </div>
      )}

      {/* List with swipe */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 alert-history-scroll touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
      >
        {serialsLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
          </div>
        ) : pageItems.length === 0 ? (
          <div className="text-center py-12 text-primary-foreground/70">
            <p>{t("deviceManage.noDevices")}</p>
            <p className="text-sm mt-2">{t("deviceManage.noDevicesHint")}</p>
          </div>
        ) : (
          pageItems.map((item, localIdx) => (
            <div
              key={itemKey(item) || localIdx}
              ref={el => { cardRefs.current[localIdx] = el; }}
              className={`transition-transform duration-150 ${
                dragFromIdx !== null && dragOverIdx !== null && localIdx === dragOverIdx && localIdx !== dragFromIdx
                  ? (dragOverIdx > dragFromIdx! ? "-translate-y-2" : "translate-y-2")
                  : ""
              }`}
            >
              <DeviceCard
                item={item}
                itemKey={itemKey(item)}
                isSelected={selectedIds.has(itemKey(item))}
                serialNumber={item.serial?.serial_key ? serialNumbers[item.serial.serial_key] : undefined}
                onToggleSelect={toggleSelect}
                onSetAsMain={handleSetAsMain}
                onNumberChange={handleSaveNumber}
                onDelete={handleDeleteDevice}
                onViewAlertHistory={onViewAlertHistory}
                onToggleMonitoring={toggleMonitoring}
                onToggleCamouflage={handleCamouflageToggle}
                onIconClick={handleIconClick}
                onSettingsClick={(deviceId) => setSettingsDeviceId(deviceId)}
                isDragging={dragFromIdx === localIdx}
                showHandle={true}
                onHandlePointerDown={(e) => handleDragPointerDown(e, localIdx)}
                onDoubleClick={(deviceId) => {
                  onSelectDevice(deviceId);
                  onClose();
                }}
                t={t}
              />
            </div>
          ))
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-center gap-3 p-3 border-t border-white/20 bg-primary/80 backdrop-blur-xl">
          <button
            onClick={() => handleBulkMonitoring(true)}
            className="px-5 py-2 rounded-lg bg-status-active text-accent-foreground font-bold text-sm shadow-[0_0_12px_hsla(48,100%,55%,0.3)]"
          >
            {t("deviceManage.bulkMonitorOn")}
          </button>
          <button
            onClick={() => handleBulkMonitoring(false)}
            className="px-5 py-2 rounded-lg bg-white/20 text-primary-foreground/80 font-bold text-sm"
          >
            {t("deviceManage.bulkMonitorOff")}
          </button>
        </div>
      )}

      {/* Pagination with arrows */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-4 border-t border-white/20">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1.5 rounded-lg text-primary-foreground/60 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                page === i + 1
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-white/10 text-white/60 hover:bg-white/15"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1.5 rounded-lg text-primary-foreground/60 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Icon modals rendered inside DeviceManage */}
      {iconPanel && (() => {
        const panelDevice = managedDevices.find(d => d.id === iconPanel.deviceId);
        return (
          <>
            {iconPanel.type === "locationMap" && (
              <LocationMapModal
                isOpen={true}
                onClose={() => setIconPanel(null)}
                deviceId={iconPanel.deviceId}
                deviceName={panelDevice?.name ?? ""}
              />
            )}
            {iconPanel.type === "networkInfo" && (
              <NetworkInfoModal
                isOpen={true}
                onClose={() => setIconPanel(null)}
                deviceId={iconPanel.deviceId}
                deviceName={panelDevice?.name ?? ""}
              />
            )}
            {iconPanel.type === "camera" && panelDevice && (
              <CameraPage
                device={panelDevice}
                isOpen={true}
                onClose={() => setIconPanel(null)}
              />
            )}
          </>
        );
      })()}

      {/* Settings modal */}
      {settingsDeviceId && (
        <SettingsPage
          devices={managedDevices}
          initialDeviceId={settingsDeviceId}
          isOpen={true}
          onClose={() => setSettingsDeviceId(null)}
          onDeviceChange={(id) => setSettingsDeviceId(id)}
        />
      )}
    </div>
  );
};

// ─── DeviceCard ───────────────────────────────────────────
interface DeviceCardProps {
  item: MatchedItem;
  itemKey: string;
  isSelected: boolean;
  serialNumber?: number;
  onToggleSelect: (key: string) => void;
  onSetAsMain: (deviceId: string) => void;
  onNumberChange: (serialKey: string, num: number | null) => void;
  onDelete: (deviceId: string) => void;
  onViewAlertHistory?: (deviceId: string) => void;
  onToggleMonitoring: (deviceId: string, enable: boolean) => void;
  onToggleCamouflage: (deviceId: string) => void;
  onIconClick?: (deviceId: string, type: "laptop" | "network" | "camera") => void;
  onSettingsClick?: (deviceId: string) => void;
  onDoubleClick?: (deviceId: string) => void;
  isDragging: boolean;
  showHandle: boolean;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  t: (key: string) => string;
}

const DeviceCard = memo(({
  item, itemKey: key, isSelected, serialNumber, onToggleSelect,
  onSetAsMain, onNumberChange, onDelete, onViewAlertHistory, onToggleMonitoring,
  onToggleCamouflage, onIconClick, onSettingsClick, onDoubleClick, isDragging, showHandle, onHandlePointerDown, t,
}: DeviceCardProps) => {
  const { serial, device } = item;
  const isMain = !!(device && (device.metadata as Record<string, unknown>)?.is_main);
  const isOnline = device ? device.status !== "offline" : false;
  const isCamouflage = !!(device && (device.metadata as Record<string, unknown>)?.camouflage_mode);
  const planConfig = PLAN_CONFIG[serial?.plan_type || "free"] || PLAN_CONFIG.free;
  const PlanIcon = planConfig.icon;

  const [localNum, setLocalNum] = useState(serialNumber != null ? String(serialNumber) : "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 외부 데이터 변경 시 로컬 상태 동기화
  useEffect(() => {
    setLocalNum(serialNumber != null ? String(serialNumber) : "");
  }, [serialNumber]);

  // ★ 자동저장: 입력 후 800ms 디바운스 (시리얼 키 기준)
  useEffect(() => {
    if (!serial?.serial_key) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const parsed = localNum.trim() === "" ? null : parseInt(localNum, 10);
      if (parsed === (serialNumber ?? null)) return;
      if (parsed !== null && (isNaN(parsed) || parsed < 1)) return;
      onNumberChange(serial.serial_key, parsed);
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [localNum]);

  return (
    <div
      onDoubleClick={() => device && onDoubleClick?.(device.id)}
      className={`rounded-xl px-3 py-2.5 bg-[hsla(220,35%,18%,0.95)] backdrop-blur-xl border shadow-xl transition-all ${
        isDragging ? "border-secondary/60 opacity-60 scale-[0.97]" : "border-white/30"
      } ${isSelected ? "ring-2 ring-secondary/50" : ""}`}
    >
      {/* Top row: name + number input + menu */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {showHandle && (
            <div
              onPointerDown={onHandlePointerDown}
              className="shrink-0 cursor-grab active:cursor-grabbing touch-none p-0.5 -ml-0.5"
            >
              <GripVertical className="w-4 h-4 text-white/40" />
            </div>
          )}
          {device && (
            <button onClick={() => onToggleSelect(key)} className="shrink-0">
              {isSelected
                ? <CheckSquare className="w-4 h-4 text-secondary" />
                : <Square className="w-4 h-4 text-white/40" />
              }
            </button>
          )}
          {isMain && (
            <span className="bg-status-active text-accent-foreground px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0">
              MAIN
            </span>
          )}
          {device ? (
            <span className="text-white font-bold text-sm truncate drop-shadow-sm">{device.name}</span>
          ) : serial?.device_name ? (
            <span className="text-white/80 font-semibold text-sm truncate drop-shadow-sm">{serial.device_name}</span>
          ) : (
            <span className="text-white/70 text-xs font-medium">{t("deviceManage.noDeviceConnected")}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {serial && (
            <input
              type="number"
              min={1}
              value={localNum}
              onChange={e => setLocalNum(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="#"
              className="w-9 h-6 rounded-md bg-white/10 border border-white/20 text-white text-center text-xs font-bold placeholder:text-white/30 focus:outline-none focus:border-white/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          )}
          {device && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-primary-foreground p-0.5 shrink-0">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-primary/90 backdrop-blur-xl border border-white/25 z-[100]">
                {!isMain && (
                  <DropdownMenuItem onClick={() => onSetAsMain(device.id)} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
                    {t("deviceManage.setAsMain")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onViewAlertHistory?.(device.id)} className="text-primary-foreground focus:bg-white/15 focus:text-primary-foreground">
                  {t("deviceManage.alertHistory")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(device.id)} className="text-destructive focus:bg-white/15 focus:text-destructive">
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Serial info + remaining days (same row) */}
      {serial && serial.serial_key && (
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span className="font-mono text-xs font-bold tracking-wider text-yellow-300 drop-shadow-sm">
            {serial.serial_key}
          </span>
          <span className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${planConfig.bgClass}`}>
            <PlanIcon className={`w-2.5 h-2.5 ${planConfig.colorClass}`} />
            <span className={planConfig.colorClass}>{t(`plan.${serial.plan_type}`)}</span>
          </span>
          {serial.remaining_days !== null && (
            <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${
              serial.remaining_days <= 3 ? "text-red-300" :
              serial.remaining_days <= 7 ? "text-amber-300" : "text-white/60"
            }`}>
              <CalendarDays className="w-3 h-3" />
              {serial.remaining_days}{t("plan.days")}
            </span>
          )}
        </div>
      )}

      {/* Status icons + monitoring toggle */}
      {device && (
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-4">
            <StatusIcon iconOn={laptopOn} iconOff={laptopOff} active={isOnline && device.is_network_connected} label={device.device_type === "desktop" ? "Desktop" : device.device_type === "tablet" ? "Tablet" : device.device_type === "smartphone" ? "Phone" : "Laptop"} onClick={() => onIconClick?.(device.id, "laptop")} />
            <StatusIcon iconOn={wifiOn} iconOff={wifiOff} active={isOnline && device.is_network_connected} label="Network" onClick={() => onIconClick?.(device.id, "network")} />
            <StatusIcon iconOn={cameraOn} iconOff={cameraOff} active={isOnline && device.is_camera_connected} label="Camera" onClick={() => onIconClick?.(device.id, "camera")} />
            <button onClick={() => onSettingsClick?.(device.id)} className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
              <div className="w-8 h-8 flex items-center justify-center">
                <Settings className="w-6 h-6 text-white/70" />
              </div>
              <span className="text-primary-foreground text-[9px] font-medium">{t("nav.settings")}</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onToggleCamouflage(device.id)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                isCamouflage
                  ? "bg-blue-500/30 border border-blue-400/50 text-blue-300"
                  : "bg-white/10 border border-white/15 text-white/40"
              }`}
              title={isCamouflage ? t("toggle.camouflageOff") : t("toggle.camouflageOn")}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>{isCamouflage ? "ON" : "OFF"}</span>
            </button>
            <button
              onClick={() => onToggleMonitoring(device.id, !device.is_monitoring)}
              className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${
                device.is_monitoring
                  ? "bg-status-active text-accent-foreground shadow-[0_0_12px_hsla(48,100%,55%,0.4)]"
                  : "bg-white/20 text-primary-foreground/70"
              }`}
            >
              {device.is_monitoring ? t("common.on") : t("common.off")}
            </button>
          </div>
        </div>
      )}

      {/* ★ 기기 미연결이지만 이전에 매칭된 적 있는 경우 (device_name 존재) → 비활성 아이콘 표시 */}
      {!device && serial?.device_name && (
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-4">
            <StatusIcon iconOn={laptopOn} iconOff={laptopOff} active={false} label="Laptop" />
            <StatusIcon iconOn={wifiOn} iconOff={wifiOff} active={false} label="Network" />
            <StatusIcon iconOn={cameraOn} iconOff={cameraOff} active={false} label="Camera" />
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-8 h-8 flex items-center justify-center">
                <Settings className="w-6 h-6 text-white/30" />
              </div>
              <span className="text-primary-foreground/50 text-[9px] font-medium">{t("nav.settings")}</span>
            </div>
          </div>
        </div>
      )}

      {/* 한번도 매칭된 적 없는 시리얼 → "기기 미연결" 텍스트만 */}
      {!device && !serial?.device_name && (
        <div className="mt-1 py-1 text-center">
          <span className="text-white/60 text-xs font-medium">⏳ {t("deviceManage.noDeviceConnected")}</span>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Custom shallow comparison to avoid unnecessary re-renders
  if (prev.isDragging !== next.isDragging) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.serialNumber !== next.serialNumber) return false;
  if (prev.showHandle !== next.showHandle) return false;
  // Compare item data by value (not reference)
  const pDev = prev.item.device;
  const nDev = next.item.device;
  if (pDev?.name !== nDev?.name) return false;
  if (pDev?.status !== nDev?.status) return false;
  if (pDev?.is_monitoring !== nDev?.is_monitoring) return false;
  if (pDev?.is_network_connected !== nDev?.is_network_connected) return false;
  if (pDev?.is_camera_connected !== nDev?.is_camera_connected) return false;
  if (pDev?.id !== nDev?.id) return false;
  const pMeta = pDev?.metadata as Record<string, unknown> | null;
  const nMeta = nDev?.metadata as Record<string, unknown> | null;
  if (pMeta?.is_main !== nMeta?.is_main) return false;
  if (pMeta?.camouflage_mode !== nMeta?.camouflage_mode) return false;
  const pSerial = prev.item.serial;
  const nSerial = next.item.serial;
  if (pSerial?.serial_key !== nSerial?.serial_key) return false;
  if (pSerial?.plan_type !== nSerial?.plan_type) return false;
  if (pSerial?.remaining_days !== nSerial?.remaining_days) return false;
  if (pSerial?.device_name !== nSerial?.device_name) return false;
  return true;
});

// ─── StatusIcon ───────────────────────────────────────────
const StatusIcon = ({ iconOn, iconOff, active, label, onClick }: { iconOn: string; iconOff: string; active: boolean; label: string; onClick?: () => void }) => (
  <button onClick={onClick} className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
    <img src={active ? iconOn : iconOff} alt={label} className="w-8 h-8 object-contain" />
    <span className="text-primary-foreground text-[9px] font-medium">{label}</span>
  </button>
);

export default DeviceManagePage;
