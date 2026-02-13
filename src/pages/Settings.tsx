import { ArrowLeft, ChevronRight, Play, Square, Upload, VolumeX, Volume2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { isMuted as isAlarmMuted, setMuted as setAlarmMuted, getVolume as getAlarmVolume, setVolume as setAlarmVolume } from "@/lib/alarmSound";
import { Slider } from "@/components/ui/slider";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface SettingsPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

interface SensorSettings {
  deviceType: "laptop" | "desktop" | "tablet";
  lidClosed: boolean;
  camera: boolean;
  microphone: boolean;
  keyboard: boolean;
  keyboardType: "wired" | "wireless";
  mouse: boolean;
  mouseType: "wired" | "wireless";
  usb: boolean;
  power: boolean;
}

type MotionSensitivity = "sensitive" | "normal" | "insensitive";

const SENSITIVITY_MAP: Record<MotionSensitivity, { label: string }> = {
  sensitive: { label: "민감" },
  normal: { label: "보통" },
  insensitive: { label: "둔감" },
};

// Built-in alarm sounds with AudioContext synthesis
const ALARM_SOUNDS: { id: string; label: string; freq: number[]; pattern: number[] }[] = [
  { id: "whistle", label: "호루라기", freq: [2200, 1800], pattern: [0.15, 0.1] },
  { id: "siren", label: "사이렌", freq: [660, 880], pattern: [0.3, 0.3] },
  { id: "bird", label: "새소리", freq: [1400, 1800, 2200], pattern: [0.1, 0.08, 0.12] },
  { id: "police", label: "경찰 사이렌", freq: [600, 1200], pattern: [0.5, 0.5] },
  { id: "radio", label: "전파음", freq: [440, 520, 600], pattern: [0.2, 0.15, 0.2] },
  { id: "quiet", label: "조용한 사이렌", freq: [400, 500], pattern: [0.4, 0.4] },
];

const DEFAULT_SENSOR_SETTINGS: SensorSettings = {
  deviceType: "laptop",
  lidClosed: false,
  camera: false,
  microphone: false,
  keyboard: false,
  keyboardType: "wired",
  mouse: false,
  mouseType: "wired",
  usb: false,
  power: false,
};

async function playBuiltinSound(sound: typeof ALARM_SOUNDS[number], duration = 2): Promise<{ stop: () => void }> {
  const ctx = new AudioContext();
  // Must await resume for mobile browsers
  await ctx.resume();
  
  let t = 0;
  const nodes: OscillatorNode[] = [];
  while (t < duration) {
    for (let i = 0; i < sound.freq.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = sound.freq[i];
      osc.type = "square";
      gain.gain.value = 0.3;
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + sound.pattern[i]);
      nodes.push(osc);
      t += sound.pattern[i] + 0.05;
      if (t >= duration) break;
    }
  }
  return {
    stop: () => {
      nodes.forEach((n) => { try { n.stop(); } catch {} });
      ctx.close();
    },
  };
}

const SettingsPage = ({ device, isOpen, onClose }: SettingsPageProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<{ stop: () => void } | null>(null);

  const meta = (device.metadata as Record<string, unknown>) || {};

  const [nickname, setNickname] = useState(device.name);
  const [alarmPin, setAlarmPin] = useState((meta.alarm_pin as string) || "1234");
  const [selectedSoundId, setSelectedSoundId] = useState(
    (meta.alarm_sound_id as string) || "whistle"
  );
  const [customSoundName, setCustomSoundName] = useState(
    (meta.custom_sound_name as string) || ""
  );
  const [customSoundDataUrl, setCustomSoundDataUrl] = useState(
    localStorage.getItem(`meercop_custom_sound_${device.id}`) || ""
  );
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [sensorSettings, setSensorSettings] = useState<SensorSettings>(() => {
    const saved = meta.sensorSettings as SensorSettings | undefined;
    return saved
      ? { ...DEFAULT_SENSOR_SETTINGS, ...saved }
      : { ...DEFAULT_SENSOR_SETTINGS, deviceType: (device.device_type as "laptop" | "desktop" | "tablet") || "laptop" };
  });
  const [motionSensitivity, setMotionSensitivity] = useState<MotionSensitivity>(
    (meta.motionSensitivity as MotionSensitivity) || "insensitive"
  );

  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [showSoundDialog, setShowSoundDialog] = useState(false);
  const [tempNickname, setTempNickname] = useState(nickname);
  const [tempPin, setTempPin] = useState(alarmPin);

  useEffect(() => {
    setNickname(device.name);
    const m = (device.metadata as Record<string, unknown>) || {};
    setAlarmPin((m.alarm_pin as string) || "1234");
    setSelectedSoundId((m.alarm_sound_id as string) || "whistle");
    setCustomSoundName((m.custom_sound_name as string) || "");
    const saved = m.sensorSettings as SensorSettings | undefined;
    if (saved) setSensorSettings({ ...DEFAULT_SENSOR_SETTINGS, ...saved });
    setMotionSensitivity((m.motionSensitivity as MotionSensitivity) || "insensitive");
  }, [device]);

  // 설정 페이지를 처음 열 때 DB에 기본 설정값이 없으면 자동 저장
  useEffect(() => {
    if (!isOpen) return;
    const m = (device.metadata as Record<string, unknown>) || {};
    if (!m.sensorSettings) {
      const defaults = {
        sensorSettings: { ...DEFAULT_SENSOR_SETTINGS, deviceType: (device.device_type as "laptop" | "desktop" | "tablet") || "laptop" },
        alarm_pin: (m.alarm_pin as string) || "1234",
        alarm_sound_id: (m.alarm_sound_id as string) || "whistle",
        require_pc_pin: m.require_pc_pin ?? true,
        motionSensitivity: (m.motionSensitivity as string) || "insensitive",
      };
      console.log("[Settings] Saving initial defaults to DB:", defaults);
      saveMetadata(defaults);
    }
  }, [isOpen, device.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any playing sounds on unmount / close
  useEffect(() => {
    if (!isOpen) stopAllSounds();
  }, [isOpen]);

  const stopAllSounds = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (synthRef.current) { synthRef.current.stop(); synthRef.current = null; }
    setPlayingSoundId(null);
  };

  const previewSound = async (soundId: string) => {
    stopAllSounds();
    if (playingSoundId === soundId) return; // was playing, just stop

    setPlayingSoundId(soundId);

    if (soundId === "custom" && customSoundDataUrl) {
      const audio = new Audio();
      // Unlock on iOS by calling play immediately in gesture context
      audio.play().catch(() => {});
      audio.src = customSoundDataUrl;
      audioRef.current = audio;
      try { await audio.play(); } catch (e) { console.warn("Custom sound play failed:", e); }
      setTimeout(() => { audio.pause(); setPlayingSoundId(null); }, 2000);
    } else {
      const sound = ALARM_SOUNDS.find((s) => s.id === soundId);
      if (sound) {
        synthRef.current = await playBuiltinSound(sound, 2);
        setTimeout(() => { stopAllSounds(); }, 2000);
      }
    }
  };

  const saveMetadata = async (updates: Record<string, unknown>) => {
    const currentMeta = (device.metadata as Record<string, unknown>) || {};
    const newMeta = { ...currentMeta, ...updates };
    const { error } = await supabase
      .from("devices")
      .update({ metadata: newMeta as unknown as Database["public"]["Tables"]["devices"]["Update"]["metadata"] })
      .eq("id", device.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["devices"] });
  };

  const handleSaveNickname = async () => {
    try {
      const { error } = await supabase
        .from("devices")
        .update({ name: tempNickname })
        .eq("id", device.id);
      if (error) throw error;
      setNickname(tempNickname);
      setShowNicknameDialog(false);
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "저장됨", description: "닉네임이 변경되었습니다." });
    } catch {
      toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleSavePin = async () => {
    if (tempPin.length === 4 && /^\d+$/.test(tempPin)) {
      try {
        await saveMetadata({ alarm_pin: tempPin });
        setAlarmPin(tempPin);
        setShowPinDialog(false);
        toast({ title: "저장됨", description: "비밀번호가 변경되었습니다." });
      } catch {
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
    stopAllSounds();
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
    try {
      await saveMetadata({ motionSensitivity: val });
    } catch {
      toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
    }
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
        style={{ background: "hsl(224, 36%, 22%)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <button onClick={onClose} className="text-white">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-white font-bold text-lg">설정</h1>
        </div>

        {/* Settings list */}
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-white/8">
            {/* Nickname */}
            <SettingItem
              label="닉네임"
              value={nickname}
              onClick={() => { setTempNickname(nickname); setShowNicknameDialog(true); }}
            />

            {/* Alarm PIN */}
            <SettingItem
              label="경보해제 비밀번호"
              value={alarmPin}
              onClick={() => { setTempPin(""); setShowPinDialog(true); }}
            />

            {/* Alarm sound */}
            <SettingItem
              label="경보음"
              value={selectedSoundLabel}
              onClick={() => setShowSoundDialog(true)}
            />

            {/* 스마트폰 경보음 사용 여부 */}
            <div className="px-4 py-4 flex items-center justify-between">
              <div>
                <span className="text-white font-medium text-sm block">스마트폰 경보음</span>
                <span className="text-white/40 text-xs">경보 발생 시 스마트폰에서 경보음 재생</span>
              </div>
              <Switch
                checked={!isAlarmMuted()}
                onCheckedChange={(v) => {
                  setAlarmMuted(!v);
                  toast({ title: v ? "경보음 활성화" : "경보음 비활성화", description: v ? "경보 시 경보음이 울립니다." : "경보음이 꺼졌습니다. 알림은 계속 수신됩니다." });
                }}
              />
            </div>

            {/* 경보음 크기 조절 */}
            {!isAlarmMuted() && (
              <div className="px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white font-medium text-sm">경보음 크기</span>
                  <span className="text-white/50 text-sm">{Math.round(getAlarmVolume() * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <VolumeX className="w-4 h-4 text-white/40 flex-shrink-0" />
                  <Slider
                    defaultValue={[getAlarmVolume() * 100]}
                    min={5}
                    max={100}
                    step={5}
                    onValueChange={(vals) => {
                      setAlarmVolume(vals[0] / 100);
                    }}
                    className="flex-1"
                  />
                  <Volume2 className="w-4 h-4 text-white/40 flex-shrink-0" />
                </div>
              </div>
            )}

            <div className="px-4 py-4 flex items-center justify-between">
              <div>
                <span className="text-white font-medium text-sm block">컴퓨터 경보 해제 시 비밀번호</span>
                <span className="text-white/40 text-xs">컴퓨터에서 경보 해제 시 비밀번호 입력 필요</span>
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

            {/* Section: Sensor Settings */}
            <div className="px-4 pt-5 pb-2">
              <span className="text-white/50 font-bold text-xs uppercase tracking-wider">감지 센서 설정</span>
            </div>

            {/* Device Type Selector */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-white font-medium text-sm block">기기 타입</span>
                  <span className="text-white/40 text-xs">기기 타입에 따라 사용 가능한 센서가 달라집니다</span>
                </div>
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
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      sensorSettings.deviceType === type
                        ? "bg-accent text-accent-foreground shadow-md"
                        : "bg-white/8 text-white/60 hover:bg-white/12"
                    }`}
                  >
                    {type === "laptop" ? "노트북" : type === "desktop" ? "데스크탑" : "태블릿"}
                  </button>
                ))}
              </div>
            </div>

            {/* Sensor toggles */}
            <SensorSection>
              <SensorToggle
                label="카메라 모션 감지"
                description="카메라로 움직임을 감지합니다"
                checked={sensorSettings.camera}
                onChange={(v) => handleSensorToggle("camera", v)}
              />
            </SensorSection>

            {/* Motion Sensitivity - only when camera is enabled */}
            {sensorSettings.camera && (
              <div className="px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white font-medium text-sm">카메라 모션 민감도</span>
                </div>
                <div className="flex gap-2">
                  {(Object.keys(SENSITIVITY_MAP) as MotionSensitivity[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => handleSensitivityChange(key)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        motionSensitivity === key
                          ? "bg-accent text-accent-foreground shadow-md"
                          : "bg-white/8 text-white/60 hover:bg-white/12"
                      }`}
                    >
                      {SENSITIVITY_MAP[key].label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 덮개 감지 - 항상 표시, 노트북만 활성 */}
            <SensorSection>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-medium text-sm block">덮개 (리드) 감지</span>
                  {isLaptop ? (
                    <span className="text-white/40 text-xs">노트북 덮개 열림/닫힘을 감지합니다</span>
                  ) : (
                    <span className="text-white/40 text-xs">노트북 기기에서만 사용할 수 있습니다</span>
                  )}
                </div>
                <Switch
                  checked={sensorSettings.lidClosed}
                  onCheckedChange={(v) => handleSensorToggle("lidClosed", v)}
                  disabled={!isLaptop}
                />
              </div>
            </SensorSection>

            {/* 마이크 감지 - 모든 기기 */}
            <SensorSection>
              <SensorToggle
                label="마이크 감지"
                description="주변 소리를 감지합니다"
                checked={sensorSettings.microphone}
                onChange={(v) => handleSensorToggle("microphone", v)}
              />
            </SensorSection>

            <SensorSection>
              <SensorToggle
                label="키보드 감지"
                description="키보드 입력을 감지합니다"
                checked={sensorSettings.keyboard}
                onChange={(v) => handleSensorToggle("keyboard", v)}
              />
            </SensorSection>

            <SensorSection>
              <SensorToggle
                label="마우스 감지"
                description="마우스 움직임을 감지합니다"
                checked={sensorSettings.mouse}
                onChange={(v) => handleSensorToggle("mouse", v)}
              />
            </SensorSection>

            <SensorSection>
              <SensorToggle
                label="USB 연결 감지"
                description="USB 장치 연결을 감지합니다"
                checked={sensorSettings.usb}
                onChange={(v) => handleSensorToggle("usb", v)}
              />
            </SensorSection>

            <SensorSection>
              <SensorToggle
                label="전원 케이블 감지"
                description="전원 연결 해제를 감지합니다"
                checked={sensorSettings.power}
                onChange={(v) => handleSensorToggle("power", v)}
              />
            </SensorSection>

            <div className="h-10" />
          </div>
        </div>
      </div>

      {/* Nickname Dialog */}
      <Dialog open={showNicknameDialog} onOpenChange={setShowNicknameDialog}>
        <DialogContent style={{ background: "hsl(224, 36%, 28%)", borderColor: "hsl(224, 30%, 35%)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">닉네임 변경</DialogTitle>
            <DialogDescription className="text-white/50">변경할 닉네임을 입력해 주세요.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={tempNickname}
              onChange={(e) => setTempNickname(e.target.value)}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowNicknameDialog(false)} className="flex-1 border-white/20 text-white hover:bg-white/10">취소</Button>
              <Button onClick={handleSaveNickname} className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">변경</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent style={{ background: "hsl(224, 36%, 28%)", borderColor: "hsl(224, 30%, 35%)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">경보해제 비밀번호 변경</DialogTitle>
            <DialogDescription className="text-white/50">4자리 숫자를 입력해 주세요.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-13 h-13 border-2 border-white/25 rounded-xl flex items-center justify-center text-white text-2xl font-bold"
                  style={{ width: 52, height: 52 }}
                >
                  {tempPin[i] ? "•" : ""}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"].map((num, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (num === "del") setTempPin(tempPin.slice(0, -1));
                    else if (num !== null && tempPin.length < 4) setTempPin(tempPin + num);
                  }}
                  disabled={num === null}
                  className={`h-13 rounded-xl font-bold text-lg transition-all ${
                    num === null ? "invisible" : "bg-white/10 text-white active:bg-white/25 active:scale-95"
                  }`}
                  style={{ height: 52 }}
                >
                  {num === "del" ? "⌫" : num}
                </button>
              ))}
            </div>
            <Button
              onClick={handleSavePin}
              disabled={tempPin.length !== 4}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40"
            >
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sound Dialog */}
      <Dialog open={showSoundDialog} onOpenChange={(open) => { setShowSoundDialog(open); if (!open) stopAllSounds(); }}>
        <DialogContent style={{ background: "hsl(224, 36%, 28%)", borderColor: "hsl(224, 30%, 35%)" }} className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">경보음 선택</DialogTitle>
            <DialogDescription className="text-white/50">사용할 경보음을 선택하세요.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {ALARM_SOUNDS.map((sound) => (
              <div
                key={sound.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                  selectedSoundId === sound.id
                    ? "bg-accent/20 ring-1 ring-accent"
                    : "bg-white/6 hover:bg-white/10"
                }`}
                onClick={() => handleSelectSound(sound.id)}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); previewSound(sound.id); }}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 hover:bg-white/20 transition-colors"
                >
                  {playingSoundId === sound.id ? (
                    <Square className="w-4 h-4 text-accent fill-accent" />
                  ) : (
                    <Play className="w-4 h-4 text-white/80 ml-0.5" />
                  )}
                </button>
                <span className="text-white font-medium text-sm flex-1">{sound.label}</span>
                {selectedSoundId === sound.id && (
                  <span className="text-accent font-bold">✓</span>
                )}
              </div>
            ))}

            {/* Custom sound */}
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                selectedSoundId === "custom"
                  ? "bg-accent/20 ring-1 ring-accent"
                  : "bg-white/6 hover:bg-white/10"
              }`}
              onClick={() => { if (customSoundDataUrl) handleSelectSound("custom"); else fileInputRef.current?.click(); }}
            >
              {customSoundDataUrl ? (
                <button
                  onClick={(e) => { e.stopPropagation(); previewSound("custom"); }}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 hover:bg-white/20 transition-colors"
                >
                  {playingSoundId === "custom" ? (
                    <Square className="w-4 h-4 text-accent fill-accent" />
                  ) : (
                    <Play className="w-4 h-4 text-white/80 ml-0.5" />
                  )}
                </button>
              ) : (
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Upload className="w-4 h-4 text-white/60" />
                </div>
              )}
              <div className="flex-1">
                <span className="text-white font-medium text-sm block">
                  {customSoundName || "내 기기에서 선택"}
                </span>
                {customSoundDataUrl && (
                  <button
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="text-white/40 text-xs underline mt-0.5"
                  >
                    다른 파일 선택
                  </button>
                )}
              </div>
              {selectedSoundId === "custom" && (
                <span className="text-accent font-bold">✓</span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleCustomSoundUpload}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Sub-components
interface SettingItemProps {
  label: string;
  value?: string;
  onClick?: () => void;
}

const SettingItem = ({ label, value, onClick }: SettingItemProps) => (
  <button onClick={onClick} className="flex items-center justify-between w-full px-4 py-4 text-left active:bg-white/5 transition-colors">
    <span className="text-white font-medium text-sm">{label}</span>
    <div className="flex items-center gap-2">
      {value && <span className="text-white/50 text-sm">{value}</span>}
      <ChevronRight className="w-5 h-5 text-white/30" />
    </div>
  </button>
);

const SensorSection = ({ children }: { children: React.ReactNode }) => (
  <div className="px-4 py-3.5">{children}</div>
);

interface SensorToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SensorToggle = ({ label, description, checked, onChange }: SensorToggleProps) => (
  <div className="flex items-center justify-between">
    <div>
      <span className="text-white font-medium text-sm block">{label}</span>
      <span className="text-white/40 text-xs">{description}</span>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export default SettingsPage;
