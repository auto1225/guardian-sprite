import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Device = Database["public"]["Tables"]["devices"]["Row"];

interface SettingsPageProps {
  device: Device;
  isOpen: boolean;
  onClose: () => void;
}

interface SensorSettings {
  deviceType: "laptop" | "desktop";
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

const SENSITIVITY_MAP: Record<MotionSensitivity, { label: string; value: number }> = {
  sensitive: { label: "민감 (10%)", value: 1 },
  normal: { label: "보통 (50%)", value: 2 },
  insensitive: { label: "둔감 (80%)", value: 3 },
};

const ALARM_SOUNDS = [
  "호루라기",
  "사이렌",
  "새소리",
  "경찰 사이렌",
  "전파음",
  "조용한 사이렌",
];

const DEFAULT_SENSOR_SETTINGS: SensorSettings = {
  deviceType: "laptop",
  lidClosed: true,
  camera: true,
  microphone: false,
  keyboard: true,
  keyboardType: "wired",
  mouse: true,
  mouseType: "wired",
  usb: true,
  power: true,
};

const SettingsPage = ({ device, isOpen, onClose }: SettingsPageProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const meta = (device.metadata as Record<string, unknown>) || {};

  const [nickname, setNickname] = useState(device.name);
  const [alarmPin, setAlarmPin] = useState((meta.alarm_pin as string) || "1234");
  const [selectedSound, setSelectedSound] = useState("호루라기");
  const [sensorSettings, setSensorSettings] = useState<SensorSettings>(() => {
    const saved = meta.sensorSettings as SensorSettings | undefined;
    return saved ? { ...DEFAULT_SENSOR_SETTINGS, ...saved } : { ...DEFAULT_SENSOR_SETTINGS, deviceType: device.device_type as "laptop" | "desktop" };
  });
  const [motionSensitivity, setMotionSensitivity] = useState<MotionSensitivity>(
    (meta.motionSensitivity as MotionSensitivity) || "normal"
  );

  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [showSoundDialog, setShowSoundDialog] = useState(false);
  const [tempNickname, setTempNickname] = useState(nickname);
  const [tempPin, setTempPin] = useState(alarmPin);

  // Sync from device prop changes
  useEffect(() => {
    setNickname(device.name);
    const m = (device.metadata as Record<string, unknown>) || {};
    setAlarmPin((m.alarm_pin as string) || "1234");
    const saved = m.sensorSettings as SensorSettings | undefined;
    if (saved) setSensorSettings({ ...DEFAULT_SENSOR_SETTINGS, ...saved });
    setMotionSensitivity((m.motionSensitivity as MotionSensitivity) || "normal");
  }, [device]);

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

  const handleSensorToggle = async (key: keyof SensorSettings, value: boolean) => {
    const updated = { ...sensorSettings, [key]: value };
    setSensorSettings(updated);
    try {
      await saveMetadata({ sensorSettings: updated });
    } catch {
      toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
      setSensorSettings(sensorSettings); // revert
    }
  };

  const handleSensitivityChange = async (val: MotionSensitivity) => {
    setMotionSensitivity(val);
    try {
      await saveMetadata({ motionSensitivity: val });
    } catch {
      toast({ title: "오류", description: "설정 저장에 실패했습니다.", variant: "destructive" });
      setMotionSensitivity(motionSensitivity); // revert
    }
  };

  const isLaptop = sensorSettings.deviceType === "laptop";

  return (
    <>
      <div className={`fixed inset-0 bg-primary z-50 flex flex-col transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-primary-foreground/20">
          <button onClick={onClose} className="text-primary-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-primary-foreground font-bold text-lg">설정</h1>
        </div>

        {/* Settings list */}
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-primary-foreground/10">
            {/* Nickname */}
            <SettingItem
              label="닉네임"
              value={nickname}
              onClick={() => { setTempNickname(nickname); setShowNicknameDialog(true); }}
            />

            {/* Alarm PIN */}
            <SettingItem
              label="경보해제 비밀번호"
              value={alarmPin.replace(/./g, "•")}
              onClick={() => { setTempPin(""); setShowPinDialog(true); }}
            />

            {/* Alarm sound */}
            <SettingItem
              label="경보음"
              value={selectedSound}
              onClick={() => setShowSoundDialog(true)}
            />

            {/* Section: Sensor Settings */}
            <div className="px-4 pt-5 pb-2">
              <span className="text-primary-foreground font-bold text-sm uppercase tracking-wider opacity-60">감지 센서 설정</span>
            </div>

            {/* Motion Sensitivity */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-primary-foreground font-medium">카메라 모션 민감도</span>
              </div>
              <div className="flex gap-2">
                {(Object.keys(SENSITIVITY_MAP) as MotionSensitivity[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => handleSensitivityChange(key)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      motionSensitivity === key
                        ? "bg-accent text-accent-foreground"
                        : "bg-primary-foreground/10 text-primary-foreground/70"
                    }`}
                  >
                    {SENSITIVITY_MAP[key].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sensor toggles */}
            <div className="px-4 py-3">
              <SensorToggle
                label="카메라 모션 감지"
                description="카메라로 움직임을 감지합니다"
                checked={sensorSettings.camera}
                onChange={(v) => handleSensorToggle("camera", v)}
              />
            </div>

            {isLaptop && (
              <div className="px-4 py-3">
                <SensorToggle
                  label="덮개 (리드) 감지"
                  description="노트북 덮개 열림/닫힘을 감지합니다"
                  checked={sensorSettings.lidClosed}
                  onChange={(v) => handleSensorToggle("lidClosed", v)}
                />
              </div>
            )}

            {!isLaptop && (
              <div className="px-4 py-3">
                <SensorToggle
                  label="마이크 감지"
                  description="주변 소리를 감지합니다"
                  checked={sensorSettings.microphone}
                  onChange={(v) => handleSensorToggle("microphone", v)}
                />
              </div>
            )}

            <div className="px-4 py-3">
              <SensorToggle
                label="키보드 감지"
                description="키보드 입력을 감지합니다"
                checked={sensorSettings.keyboard}
                onChange={(v) => handleSensorToggle("keyboard", v)}
              />
            </div>

            <div className="px-4 py-3">
              <SensorToggle
                label="마우스 감지"
                description="마우스 움직임을 감지합니다"
                checked={sensorSettings.mouse}
                onChange={(v) => handleSensorToggle("mouse", v)}
              />
            </div>

            <div className="px-4 py-3">
              <SensorToggle
                label="USB 연결 감지"
                description="USB 장치 연결을 감지합니다"
                checked={sensorSettings.usb}
                onChange={(v) => handleSensorToggle("usb", v)}
              />
            </div>

            <div className="px-4 py-3">
              <SensorToggle
                label="전원 케이블 감지"
                description="전원 연결 해제를 감지합니다"
                checked={sensorSettings.power}
                onChange={(v) => handleSensorToggle("power", v)}
              />
            </div>

            {/* Bottom spacing */}
            <div className="h-8" />
          </div>
        </div>
      </div>

      {/* Nickname Dialog */}
      <Dialog open={showNicknameDialog} onOpenChange={setShowNicknameDialog}>
        <DialogContent className="bg-primary border-primary-foreground/20">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground">닉네임 변경</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-primary-foreground/70 text-sm">변경할 닉네임을 입력해 주세요.</p>
            <Input
              value={tempNickname}
              onChange={(e) => setTempNickname(e.target.value)}
              className="bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowNicknameDialog(false)} className="flex-1">취소</Button>
              <Button onClick={handleSaveNickname} className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">변경</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="bg-primary border-primary-foreground/20">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground">경보해제 비밀번호 변경</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-12 h-12 border-2 border-primary-foreground/30 rounded-lg flex items-center justify-center text-primary-foreground text-xl"
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
                  className={`h-12 rounded-lg font-bold text-lg ${
                    num === null ? "invisible" : "bg-primary-foreground/10 text-primary-foreground active:bg-primary-foreground/20"
                  }`}
                >
                  {num === "del" ? "⌫" : num}
                </button>
              ))}
            </div>
            <Button
              onClick={handleSavePin}
              disabled={tempPin.length !== 4}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sound Dialog */}
      <Dialog open={showSoundDialog} onOpenChange={setShowSoundDialog}>
        <DialogContent className="bg-primary border-primary-foreground/20">
          <DialogHeader>
            <DialogTitle className="text-primary-foreground">경보음</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {ALARM_SOUNDS.map((sound) => (
              <button
                key={sound}
                onClick={() => { setSelectedSound(sound); setShowSoundDialog(false); }}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between ${
                  selectedSound === sound
                    ? "bg-accent text-accent-foreground"
                    : "bg-primary-foreground/10 text-primary-foreground"
                }`}
              >
                <span>{sound}</span>
                {selectedSound === sound && <span>✓</span>}
              </button>
            ))}
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
  <button onClick={onClick} className="flex items-center justify-between w-full px-4 py-4 text-left">
    <span className="text-primary-foreground font-medium">{label}</span>
    <div className="flex items-center gap-2">
      {value && <span className="text-primary-foreground/70">{value}</span>}
      <ChevronRight className="w-5 h-5 text-primary-foreground/50" />
    </div>
  </button>
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
      <span className="text-primary-foreground font-medium text-sm block">{label}</span>
      <span className="text-primary-foreground/50 text-xs">{description}</span>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export default SettingsPage;
