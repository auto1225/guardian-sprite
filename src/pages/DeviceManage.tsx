import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, MoreVertical, Crown, Star, Sparkles, CalendarDays, GripVertical, ChevronLeft, ChevronRight, ArrowUpDown, CheckSquare, Square } from "lucide-react";
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
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [licenseMap, setLicenseMap] = useState<Map<string, string>>(new Map());

  // Drag state
  const dragState = useRef<{
    active: boolean;
    fromGlobalIdx: number;
    startY: number;
    currentOverIdx: number | null;
  }>({ active: false, fromGlobalIdx: -1, startY: 0, currentOverIdx: null });
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Swipe state
  const touchStartX = useRef(0);
  const swipeActive = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const managedDevices = devices.filter(d => d.device_type !== "smartphone");

  // Fetch licenses
  useEffect(() => {
    if (!effectiveUserId || serials.length === 0) return;
    const fetchLicenses = async () => {
      try {
        const serialKeys = serials.map(s => s.serial_key).filter(Boolean);
        if (serialKeys.length === 0) return;
        const { data: licData, error: licError } = await supabase
          .from("licenses")
          .select("serial_key, device_id")
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
            const deviceSerial = (device.metadata as Record<string, unknown>)?.serial_key;
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
      // ★ 번호순: metadata.user_number 기준 정렬 (없으면 끝으로)
      sorted.sort((a, b) => {
        const aNum = (a.device?.metadata as Record<string, unknown>)?.user_number as number | undefined;
        const bNum = (b.device?.metadata as Record<string, unknown>)?.user_number as number | undefined;
        return (aNum ?? Infinity) - (bNum ?? Infinity);
      });
    } else if (sortMode === "plan") {
      sorted.sort((a, b) => (PLAN_ORDER[a.serial?.plan_type || "free"] ?? 2) - (PLAN_ORDER[b.serial?.plan_type || "free"] ?? 2));
    } else if (sortMode === "days") {
      sorted.sort((a, b) => (a.serial?.remaining_days ?? 9999) - (b.serial?.remaining_days ?? 9999));
    } else if (sortMode === "monitoring") {
      sorted.sort((a, b) => (a.device?.is_monitoring ? 0 : 1) - (b.device?.is_monitoring ? 0 : 1));
    } else {
      // ★ Default: sort_order → created_at 순서 (안정적, 온라인 상태로 순서 바뀌지 않음)
      sorted.sort((a, b) => {
        const aOrder = (a.device?.metadata as Record<string, unknown>)?.sort_order as number | undefined;
        const bOrder = (b.device?.metadata as Record<string, unknown>)?.sort_order as number | undefined;
        if (aOrder !== undefined || bOrder !== undefined) {
          return (aOrder ?? Infinity) - (bOrder ?? Infinity);
        }
        // sort_order가 없으면 created_at 순
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
    dragState.current = { active: true, fromGlobalIdx: globalIdx, startY: e.clientY, currentOverIdx: localIdx };
    setDragFromIdx(localIdx);
    setDragOverIdx(localIdx);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.active || !listRef.current) return;
    // Find which card the pointer is over
    const rects = cardRefs.current.map(el => el?.getBoundingClientRect());
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
  }, []);

  const handleDragPointerUp = useCallback(() => {
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
    }
    setDragFromIdx(null);
    setDragOverIdx(null);
  }, [dragFromIdx, page, items, itemKey]);

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

  const handleSaveNumber = async (deviceId: string, num: number | null) => {
    try {
      await safeMetadataUpdate(deviceId, { user_number: num });
      queryClient.setQueryData(["devices", effectiveUserId], (old: Device[] | undefined) => {
        if (!old) return old;
        return old.map(d => {
          if (d.id !== deviceId) return d;
          const meta = (d.metadata as Record<string, unknown>) || {};
          return { ...d, metadata: { ...meta, user_number: num } };
        });
      });
    } catch {
      toast({ title: t("common.error"), description: t("common.saveFailed"), variant: "destructive" });
    }
  };

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
                onClick={() => { setSortMode(opt.mode); setCustomOrder([]); }}
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
        className="flex-1 overflow-y-auto p-4 space-y-3 alert-history-scroll touch-pan-x"
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
                onToggleSelect={toggleSelect}
                onSetAsMain={handleSetAsMain}
                onNumberChange={handleSaveNumber}
                onDelete={handleDeleteDevice}
                onViewAlertHistory={onViewAlertHistory}
                onToggleMonitoring={toggleMonitoring}
                isDragging={dragFromIdx === localIdx}
                showHandle={true}
                onHandlePointerDown={(e) => handleDragPointerDown(e, localIdx)}
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
    </div>
  );
};

// ─── DeviceCard ───────────────────────────────────────────
interface DeviceCardProps {
  item: MatchedItem;
  itemKey: string;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
  onSetAsMain: (deviceId: string) => void;
  onNumberChange: (deviceId: string, num: number | null) => void;
  onDelete: (deviceId: string) => void;
  onViewAlertHistory?: (deviceId: string) => void;
  onToggleMonitoring: (deviceId: string, enable: boolean) => void;
  isDragging: boolean;
  showHandle: boolean;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  t: (key: string) => string;
}

const DeviceCard = ({
  item, itemKey: key, isSelected, onToggleSelect,
  onSetAsMain, onNumberChange, onDelete, onViewAlertHistory, onToggleMonitoring,
  isDragging, showHandle, onHandlePointerDown, t,
}: DeviceCardProps) => {
  const { serial, device } = item;
  const isMain = !!(device && (device.metadata as Record<string, unknown>)?.is_main);
  const userNumber = ((device || serial ? (device?.metadata as Record<string, unknown>) : null))?.user_number as number | undefined;
  const isOnline = device ? device.status !== "offline" : false;
  const planConfig = PLAN_CONFIG[serial?.plan_type || "free"] || PLAN_CONFIG.free;
  const PlanIcon = planConfig.icon;

  const [localNum, setLocalNum] = useState(userNumber != null ? String(userNumber) : "");
  
  // 외부 데이터 변경 시 로컬 상태 동기화
  useEffect(() => {
    setLocalNum(userNumber != null ? String(userNumber) : "");
  }, [userNumber]);

  const handleNumBlur = () => {
    const parsed = localNum.trim() === "" ? null : parseInt(localNum, 10);
    if (parsed === (userNumber ?? null)) return; // 변경 없음
    if (parsed !== null && (isNaN(parsed) || parsed < 1)) {
      setLocalNum(userNumber != null ? String(userNumber) : "");
      return;
    }
    const targetId = device?.id;
    if (targetId) onNumberChange(targetId, parsed);
  };

  return (
    <div
      className={`rounded-2xl p-4 bg-[hsla(220,35%,18%,0.95)] backdrop-blur-xl border shadow-xl transition-all ${
        isDragging ? "border-secondary/60 opacity-60 scale-[0.97]" : "border-white/30"
      } ${isSelected ? "ring-2 ring-secondary/50" : ""}`}
    >
      {/* Top row: name + number input + menu */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag handle */}
          {showHandle && (
            <div
              onPointerDown={onHandlePointerDown}
              className="shrink-0 cursor-grab active:cursor-grabbing touch-none p-1 -ml-1"
            >
              <GripVertical className="w-5 h-5 text-white/40" />
            </div>
          )}
          {/* Checkbox */}
          {device && (
            <button onClick={() => onToggleSelect(key)} className="shrink-0">
              {isSelected
                ? <CheckSquare className="w-5 h-5 text-secondary" />
                : <Square className="w-5 h-5 text-white/40" />
              }
            </button>
          )}
          {isMain && (
            <span className="bg-status-active text-accent-foreground px-2 py-0.5 rounded text-[10px] font-bold shrink-0">
              MAIN
            </span>
          )}
          {device ? (
            <span className="text-white font-bold truncate drop-shadow-sm">{device.name}</span>
          ) : serial?.device_name ? (
            <span className="text-white/80 font-semibold truncate drop-shadow-sm">{serial.device_name}</span>
          ) : (
            <span className="text-white/70 text-sm font-medium">{t("deviceManage.noDeviceConnected")}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Inline number input */}
          <input
            type="number"
            min={1}
            value={localNum}
            onChange={e => setLocalNum(e.target.value)}
            onBlur={handleNumBlur}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="#"
            className="w-10 h-7 rounded-lg bg-white/10 border border-white/20 text-white text-center text-xs font-bold placeholder:text-white/30 focus:outline-none focus:border-white/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {device && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-primary-foreground p-1 shrink-0">
                  <MoreVertical className="w-5 h-5" />
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

      {/* Serial info */}
      {serial && serial.serial_key && (
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-sm font-bold tracking-wider text-yellow-300 drop-shadow-sm">
            {serial.serial_key}
          </span>
          <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${planConfig.bgClass}`}>
            <PlanIcon className={`w-3 h-3 ${planConfig.colorClass}`} />
            <span className={planConfig.colorClass}>{t(`plan.${serial.plan_type}`)}</span>
          </span>
        </div>
      )}

      {/* Remaining days */}
      {serial && serial.remaining_days !== null && (
        <div className="flex items-center gap-1.5 mb-3">
          <CalendarDays className="w-3.5 h-3.5 text-white/60" />
          <span className={`text-xs font-semibold ${
            serial.remaining_days <= 3 ? "text-red-300" :
            serial.remaining_days <= 7 ? "text-amber-300" : "text-white/80"
          }`}>
            {serial.remaining_days}{t("plan.days")} {t("plan.remainingDays")}
          </span>
        </div>
      )}

      {/* Status icons + monitoring toggle */}
      {device && (
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-6">
            <StatusIcon iconOn={laptopOn} iconOff={laptopOff} active={isOnline} label={device.device_type === "desktop" ? "Desktop" : device.device_type === "tablet" ? "Tablet" : "Laptop"} />
            <StatusIcon iconOn={wifiOn} iconOff={wifiOff} active={isOnline && device.is_network_connected} label="Network" />
            <StatusIcon iconOn={cameraOn} iconOff={cameraOff} active={isOnline && device.is_camera_connected} label="Camera" />
          </div>
          <button
            onClick={() => onToggleMonitoring(device.id, !device.is_monitoring)}
            className={`px-6 py-2 rounded-lg text-base font-bold transition-all ${
              device.is_monitoring
                ? "bg-status-active text-accent-foreground shadow-[0_0_12px_hsla(48,100%,55%,0.4)]"
                : "bg-white/20 text-primary-foreground/70"
            }`}
          >
            {device.is_monitoring ? t("common.on") : t("common.off")}
          </button>
        </div>
      )}

      {!device && (
        <div className="mt-2 py-2 text-center">
          <span className="text-white/60 text-xs font-medium">⏳ {t("deviceManage.noDeviceConnected")}</span>
        </div>
      )}
    </div>
  );
};

// ─── StatusIcon ───────────────────────────────────────────
const StatusIcon = ({ iconOn, iconOff, active, label }: { iconOn: string; iconOff: string; active: boolean; label: string }) => (
  <div className="flex flex-col items-center gap-1">
    <img src={active ? iconOn : iconOff} alt={label} className="w-10 h-10 object-contain" />
    <span className="text-primary-foreground text-[10px] font-medium">{label}</span>
  </div>
);

export default DeviceManagePage;
