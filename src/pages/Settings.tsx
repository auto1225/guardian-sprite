import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { safeMetadataUpdate } from "@/lib/safeMetadataUpdate";
import { isMuted as isAlarmMuted, setMuted as setAlarmMuted } from "@/lib/alarmSound";
import { hashPin } from "@/lib/pinHash";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  SettingItem,
  SensorSection,
  SensorToggle,
  NicknameDialog,
  PinDialog,
  SoundDialog,
  ALARM_SOUNDS,
  SENSITIVITY_MAP,
  DEFAULT_SENSOR_SETTINGS,
  type SensorSettings,
  type MotionSensitivity,
} from "@/components/settings/SettingsComponents";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface SettingsPageProps {
  devices: Device[];
  initialDeviceId: string;
  isOpen: boolean;
  onClose: () => void;
}

const SettingsPage = ({ devices, initialDeviceId, isOpen, onClose }: SettingsPageProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [licenses, setLicenses] = useState<{ serial_key: string; device_id: string | null; is_active: boolean }[]>([]);
  const [settingsDeviceId, setSettingsDeviceId] = useState(initialDeviceId);

  useEffect(() => {
    if (isOpen) setSettingsDeviceId(initialDeviceId);
  }, [isOpen, initialDeviceId]);

  const device = devices.find(d => d.id === settingsDeviceId) || devices[0];

  useEffect(() => {
    if (!isOpen || !device) return;
    const fetchLicenses = async () => {
      const { data } = await supabase
        .from("licenses")
        .select("serial_key, device_id, is_active")
        .eq("user_id", device.user_id)
        .order("created_at", { ascending: true });
      setLicenses(data ?? []);
    };
    fetchLicenses();
  }, [isOpen, device?.user_id]);

  const meta = (device?.metadata as Record<string, unknown>) || {};

  const [nickname, setNickname] = useState(device?.name || "");
  const [alarmPin, setAlarmPin] = useState((meta.alarm_pin as string) || "1234");
  const [selectedSoundId, setSelectedSoundId] = useState((meta.alarm_sound_id as string) || "whistle");
  const [customSoundName, setCustomSoundName] = useState((meta.custom_sound_name as string) || "");
  const [customSoundDataUrl, setCustomSoundDataUrl] = useState(
    device ? localStorage.getItem(`meercop_custom_sound_${device.id}`) || "" : ""
  );
  const [sensorSettings, setSensorSettings] = useState<SensorSettings>(() => {
    const saved = meta.sensorSettings as SensorSettings | undefined;
    return saved
      ? { ...DEFAULT_SENSOR_SETTINGS, ...saved }
      : { ...DEFAULT_SENSOR_SETTINGS, deviceType: (device?.device_type as "laptop" | "desktop" | "tablet") || "laptop" };
  });
  const [motionSensitivity, setMotionSensitivity] = useState<MotionSensitivity>(
    (meta.motionSensitivity as MotionSensitivity) || "insensitive"
  );
  const [mouseSensitivity, setMouseSensitivity] = useState<MotionSensitivity>(
    (meta.mouseSensitivity as MotionSensitivity) || "sensitive"
  );

  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [showSoundDialog, setShowSoundDialog] = useState(false);

  // 기기가 바뀌면 설정값 재초기화
  useEffect(() => {
    if (!device) return;
    setNickname(device.name);
    const m = (device.metadata as Record<string, unknown>) || {};
    setAlarmPin((m.alarm_pin as string) || "1234");
    setSelectedSoundId((m.alarm_sound_id as string) || "whistle");
    setCustomSoundName((m.custom_sound_name as string) || "");
    setCustomSoundDataUrl(localStorage.getItem(`meercop_custom_sound_${device.id}`) || "");
    const saved = m.sensorSettings as SensorSettings | undefined;
    setSensorSettings(saved
      ? { ...DEFAULT_SENSOR_SETTINGS, ...saved }
      : { ...DEFAULT_SENSOR_SETTINGS, deviceType: (device.device_type as "laptop" | "desktop" | "tablet") || "laptop" });
    setMotionSensitivity((m.motionSensitivity as MotionSensitivity) || "insensitive");
    setMouseSensitivity((m.mouseSensitivity as MotionSensitivity) || "sensitive");
  }, [device?.id, device?.metadata]);

  // 초기 기본값 저장
  useEffect(() => {
    if (!isOpen) return;
    const m = (device.metadata as Record<string, unknown>) || {};
    if (!m.sensorSettings) {
      const pin = (m.alarm_pin as string) || "1234";
      hashPin(pin, device.id).then((pinHash) => {
        saveMetadata({
          sensorSettings: { ...DEFAULT_SENSOR_SETTINGS, deviceType: (device.device_type as "laptop" | "desktop" | "tablet") || "laptop" },
          alarm_pin: pin,
          alarm_pin_hash: pinHash,
          alarm_sound_id: (m.alarm_sound_id as string) || "whistle",
          require_pc_pin: m.require_pc_pin ?? true,
          motionSensitivity: (m.motionSensitivity as string) || "insensitive",
          mouseSensitivity: (m.mouseSensitivity as string) || "sensitive",
        });
      });
    }
  }, [isOpen, device.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMetadata = async (updates: Record<string, unknown>) => {
    await safeMetadataUpdate(device.id, updates);
    queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  const handleSaveNickname = async (name: string) => {
    try {
      const { error } = await supabase.from("devices").update({ name }).eq("id", device.id);
      if (error) throw error;
      setNickname(name);
      setShowNicknameDialog(false);
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "저장됨", description: "닉네임이 변경되었습니다." });
    } catch {
      toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleSavePin = async (pin: string) => {
    if (pin.length === 4 && /^\d+$/.test(pin)) {
      try {
        const pinHash = await hashPin(pin, device.id);
        await saveMetadata({ alarm_pin: pin, alarm_pin_hash: pinHash });
        setAlarmPin(pin);
        setShowPinDialog(false);
        toast({ title: "저장됨", description: "비밀번호가 변경되었습니다." });
      } catch (err) {
        console.error("[Settings] PIN 저장 실패:", err);
        toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
      }
    }
  };

  const handleSelectSound = async (soundId: string) => {
    setSelectedSoundId(soundId);
    try {
      await saveMetadata({ alarm_sound_id: soundId });
    } catch {
      toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
    }
    setShowSoundDialog(false);
  };

  const handleCustomSoundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "오류", description: "파일 크기는 5MB 이하여야 합니다.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      localStorage.setItem(`meercop_custom_sound_${device.id}`, dataUrl);
      setCustomSoundDataUrl(dataUrl);
      setCustomSoundName(file.name);
      setSelectedSoundId("custom");
      try {
        await saveMetadata({ alarm_sound_id: "custom", custom_sound_name: file.name });
        toast({ title: "저장됨", description: `"${file.name}" 경보음으로 설정되었습니다.` });
      } catch {
        toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSensorToggle = async (key: keyof SensorSettings, value: boolean) => {
    const updated = { ...sensorSettings, [key]: value };
    setSensorSettings(updated);
    try {
      await saveMetadata({ sensorSettings: updated });
    } catch {
      toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
      setSensorSettings(sensorSettings);
    }
  };

  const handleSensitivityChange = async (val: MotionSensitivity) => {
    setMotionSensitivity(val);
    try { await saveMetadata({ motionSensitivity: val }); }
    catch { toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" }); }
  };

  const handleMouseSensitivityChange = async (val: MotionSensitivity) => {
    setMouseSensitivity(val);
    try { await saveMetadata({ mouseSensitivity: val }); }
    catch { toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" }); }
  };

  const isLaptop = sensorSettings.deviceType === "laptop";
  const selectedSoundLabel =
    selectedSoundId === "custom"
      ? customSoundName || "사용자 지정"
      : ALARM_SOUNDS.find((s) => s.id === selectedSoundId)?.label || "호루라기";

  return (
    <>
      <div
        className={`fixed inset-0 z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ background: 'linear-gradient(180deg, hsla(200, 70%, 50%, 1) 0%, hsla(200, 65%, 38%, 1) 100%)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/20">
          <button onClick={onClose} className="text-white hover:text-white/80 transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-white font-bold text-lg">설정</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 alert-history-scroll">
          {/* Device Selector */}
          {devices.length > 1 && (
            <div className="rounded-2xl border border-white/25 overflow-hidden" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
              <div className="px-4 pt-3 pb-1">
                <span className="text-white font-semibold text-sm">설정 대상 기기</span>
              </div>
              <div className="px-4 pb-3 flex gap-2 flex-wrap">
                {devices.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSettingsDeviceId(d.id)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                      settingsDeviceId === d.id ? "text-slate-800 shadow-md" : "text-white hover:bg-white/15"
                    }`}
                    style={settingsDeviceId === d.id ? { background: 'hsla(52, 100%, 60%, 0.9)' } : { background: 'hsla(0,0%,100%,0.1)' }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Serial Numbers */}
          <div className="rounded-2xl border border-white/25 overflow-hidden" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <div>
                <span className="text-white font-semibold text-sm block">시리얼 넘버</span>
                <span className="text-white/80 text-xs">등록된 시리얼 {licenses.length}개</span>
              </div>
              <span className="text-white/40 text-xs">탭하여 복사</span>
            </div>
            <div className="max-h-[180px] overflow-y-auto alert-history-scroll">
              {licenses.length === 0 ? (
                <div className="px-4 pb-4">
                  <span className="text-white/60 text-sm">등록된 시리얼이 없습니다</span>
                </div>
              ) : (
                licenses.map((lic, idx) => (
                  <button
                    key={lic.serial_key}
                    onClick={() => {
                      navigator.clipboard.writeText(lic.serial_key);
                      toast({ title: "복사됨", description: "시리얼 넘버가 클립보드에 복사되었습니다." });
                    }}
                    className={`w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5 active:bg-white/10 transition-colors ${idx > 0 ? 'border-t border-white/10' : ''}`}
                    style={lic.device_id === device.id ? { background: 'hsla(200, 60%, 30%, 0.5)' } : undefined}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono font-bold text-sm tracking-wider" style={{ color: 'hsla(52, 100%, 60%, 1)' }}>
                        {lic.serial_key}
                      </span>
                      <span className={`text-xs mt-0.5 font-semibold ${lic.device_id === device.id ? '' : 'text-white/50'}`}
                        style={lic.device_id === device.id ? { color: 'hsla(52, 100%, 60%, 0.9)' } : undefined}
                      >
                        {lic.device_id === device.id ? '📌 현재 기기' : lic.device_id ? '🔗 다른 기기 연결됨' : '⏳ 미연결'}
                        {!lic.is_active && ' · 비활성'}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/40 shrink-0 ml-2" />
                  </button>
                ))
              )}
            </div>
          </div>

          {/* General Settings */}
          <div className="rounded-2xl border border-white/25 overflow-hidden" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
            <SettingItem label="닉네임" value={nickname} onClick={() => setShowNicknameDialog(true)} />
            <div className="border-t border-white/10" />
            <SettingItem label="경보해제 비밀번호" value={alarmPin} onClick={() => setShowPinDialog(true)} />
            <div className="border-t border-white/10" />
            <SettingItem label="경보음" value={selectedSoundLabel} onClick={() => setShowSoundDialog(true)} />
          </div>

          {/* Toggle Settings */}
          <div className="rounded-2xl border border-white/25 overflow-hidden" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
            <div className="px-4 py-4 flex items-center justify-between">
              <div>
                <span className="text-white font-semibold text-sm block">스마트폰 경보음</span>
                <span className="text-white/80 text-xs">경보 발생 시 스마트폰에서 경보음 재생</span>
              </div>
              <Switch
                checked={!isAlarmMuted()}
                onCheckedChange={(v) => {
                  setAlarmMuted(!v);
                  toast({ title: v ? "경보음 활성화" : "경보음 비활성화", description: v ? "경보 시 경보음이 울립니다." : "경보음이 꺼졌습니다. 알림은 계속 수신됩니다." });
                }}
              />
            </div>
            <div className="border-t border-white/10" />
            <div className="px-4 py-4 flex items-center justify-between">
              <div>
                <span className="text-white font-semibold text-sm block">컴퓨터 경보 해제 시 비밀번호</span>
                <span className="text-white/80 text-xs">컴퓨터에서 경보 해제 시 비밀번호 입력 필요</span>
              </div>
              <Switch
                checked={!!(meta.require_pc_pin as boolean)}
                onCheckedChange={async (v) => {
                  try {
                    await saveMetadata({ require_pc_pin: v });
                    toast({ title: v ? "활성화" : "비활성화", description: v ? "컴퓨터에서 비밀번호 입력이 필요합니다." : "컴퓨터에서 비밀번호 없이 해제할 수 있습니다." });
                  } catch {
                    toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
                  }
                }}
              />
            </div>
          </div>

          {/* Sensor Settings */}
          <div className="pt-2 pb-1">
            <span className="text-white font-bold text-xs uppercase tracking-wider">감지 센서 설정</span>
          </div>

          {/* Device Type */}
          <div className="rounded-2xl p-4 border border-white/25" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
            <div className="mb-3">
              <span className="text-white font-semibold text-sm block">기기 타입</span>
              <span className="text-white/80 text-xs">기기 타입에 따라 사용 가능한 센서가 달라집니다</span>
            </div>
            <div className="flex gap-2">
              {(["laptop", "desktop", "tablet"] as const).map((type) => (
                <button
                  key={type}
                  onClick={async () => {
                    const updated = { ...sensorSettings, deviceType: type };
                    setSensorSettings(updated);
                    try {
                      await saveMetadata({ sensorSettings: updated });
                      await supabase.from("devices").update({ device_type: type }).eq("id", device.id);
                      queryClient.invalidateQueries({ queryKey: ["devices"] });
                    } catch {
                      toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
                    }
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    sensorSettings.deviceType === type ? "text-slate-800 shadow-md" : "text-white hover:bg-white/15"
                  }`}
                  style={sensorSettings.deviceType === type ? { background: 'hsla(52, 100%, 60%, 0.9)' } : { background: 'hsla(0,0%,100%,0.1)' }}
                >
                  {type === "laptop" ? "노트북" : type === "desktop" ? "데스크탑" : "태블릿"}
                </button>
              ))}
            </div>
          </div>

          {/* Sensor toggles */}
          <div className="rounded-2xl border border-white/25 overflow-hidden" style={{ background: 'hsla(0,0%,100%,0.18)' }}>
            <SensorSection>
              <SensorToggle label="카메라 모션 감지" description="카메라로 움직임을 감지합니다" checked={sensorSettings.camera} onChange={(v) => handleSensorToggle("camera", v)} />
            </SensorSection>

            {sensorSettings.camera && (
              <>
                <div className="border-t border-white/10" />
                <div className="px-4 py-4">
                  <span className="text-white font-semibold text-sm block mb-3">카메라 모션 민감도</span>
                  <div className="flex gap-2">
                    {(Object.keys(SENSITIVITY_MAP) as MotionSensitivity[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => handleSensitivityChange(key)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          motionSensitivity === key ? "text-slate-800 shadow-md" : "text-white hover:bg-white/15"
                        }`}
                        style={motionSensitivity === key ? { background: 'hsla(52, 100%, 60%, 0.9)' } : { background: 'hsla(0,0%,100%,0.1)' }}
                      >
                        {SENSITIVITY_MAP[key].label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="border-t border-white/10" />
            <SensorSection>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-semibold text-sm block">덮개 (리드) 감지</span>
                  <span className="text-white/80 text-xs">{isLaptop ? "노트북 덮개 열림/닫힘을 감지합니다" : "노트북 기기에서만 사용할 수 있습니다"}</span>
                </div>
                <Switch checked={sensorSettings.lidClosed} onCheckedChange={(v) => handleSensorToggle("lidClosed", v)} disabled={!isLaptop} />
              </div>
            </SensorSection>

            <div className="border-t border-white/10" />
            <SensorSection>
              <SensorToggle label="마이크 감지" description="주변 소리를 감지합니다" checked={sensorSettings.microphone} onChange={(v) => handleSensorToggle("microphone", v)} />
            </SensorSection>

            <div className="border-t border-white/10" />
            <SensorSection>
              <SensorToggle label="키보드 감지" description="키보드 입력을 감지합니다" checked={sensorSettings.keyboard} onChange={(v) => handleSensorToggle("keyboard", v)} />
            </SensorSection>

            <div className="border-t border-white/10" />
            <SensorSection>
              <SensorToggle label="마우스 감지" description="마우스 움직임을 감지합니다" checked={sensorSettings.mouse} onChange={(v) => handleSensorToggle("mouse", v)} />
            </SensorSection>

            {sensorSettings.mouse && (
              <>
                <div className="border-t border-white/10" />
                <div className="px-4 py-4">
                  <span className="text-white font-semibold text-sm block mb-3">마우스 감지 민감도</span>
                  <div className="flex gap-2">
                    {(Object.keys(SENSITIVITY_MAP) as MotionSensitivity[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => handleMouseSensitivityChange(key)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                          mouseSensitivity === key ? "text-slate-800 shadow-md" : "text-white hover:bg-white/15"
                        }`}
                        style={mouseSensitivity === key ? { background: 'hsla(52, 100%, 60%, 0.9)' } : { background: 'hsla(0,0%,100%,0.1)' }}
                      >
                        {SENSITIVITY_MAP[key].label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="border-t border-white/10" />
            <SensorSection>
              <SensorToggle label="USB 연결 감지" description="USB 장치 연결을 감지합니다" checked={sensorSettings.usb} onChange={(v) => handleSensorToggle("usb", v)} />
            </SensorSection>

            <div className="border-t border-white/10" />
            <SensorSection>
              <SensorToggle label="전원 케이블 감지" description="전원 연결 해제를 감지합니다" checked={sensorSettings.power} onChange={(v) => handleSensorToggle("power", v)} />
            </SensorSection>
          </div>

          <div className="h-10" />
        </div>
      </div>

      {/* Dialogs */}
      <NicknameDialog
        open={showNicknameDialog}
        onOpenChange={setShowNicknameDialog}
        value={nickname}
        onSave={handleSaveNickname}
      />
      <PinDialog
        open={showPinDialog}
        onOpenChange={setShowPinDialog}
        onSave={handleSavePin}
      />
      <SoundDialog
        open={showSoundDialog}
        onOpenChange={setShowSoundDialog}
        selectedSoundId={selectedSoundId}
        customSoundName={customSoundName}
        customSoundDataUrl={customSoundDataUrl}
        onSelectSound={handleSelectSound}
        onCustomUpload={handleCustomSoundUpload}
        deviceId={device.id}
      />
    </>
  );
};

export default SettingsPage;
