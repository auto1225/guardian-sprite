import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
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

const SENSITIVITY_LEVELS = [
  { value: 1, label: "매우 둔감" },
  { value: 2, label: "둔감" },
  { value: 3, label: "보통" },
  { value: 4, label: "민감" },
  { value: 5, label: "매우 민감" },
];

const ALARM_SOUNDS = [
  "호루라기",
  "사이렌",
  "새소리",
  "경찰 사이렌",
  "전파음",
  "조용한 사이렌",
];

const SettingsPage = ({ device, isOpen, onClose }: SettingsPageProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [nickname, setNickname] = useState(device.name);
  const [sensitivity, setSensitivity] = useState(3);
  const [showStatusMessage, setShowStatusMessage] = useState(true);
  const [alarmDuration, setAlarmDuration] = useState(60);
  const [alarmPin, setAlarmPin] = useState("0000");
  const [selectedSound, setSelectedSound] = useState("호루라기");
  const [alerts, setAlerts] = useState({
    motion: true,
    lidOpen: true,
    powerDisconnect: true,
    usbConnect: false,
    keyboard: false,
    mouse: false,
  });

  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [showSoundDialog, setShowSoundDialog] = useState(false);
  const [tempNickname, setTempNickname] = useState(nickname);
  const [tempPin, setTempPin] = useState(alarmPin);

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
    } catch (error) {
      toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleSavePin = () => {
    if (tempPin.length === 4 && /^\d+$/.test(tempPin)) {
      setAlarmPin(tempPin);
      setShowPinDialog(false);
      toast({ title: "저장됨", description: "비밀번호가 변경되었습니다." });
    }
  };

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
              onClick={() => {
                setTempNickname(nickname);
                setShowNicknameDialog(true);
              }}
            />

            {/* Sensitivity */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-primary-foreground font-medium">민감도</span>
                <span className="text-primary-foreground/70 text-sm">
                  Lv.{sensitivity} - {SENSITIVITY_LEVELS.find(l => l.value === sensitivity)?.label}
                </span>
              </div>
              <Slider
                value={[sensitivity]}
                onValueChange={([val]) => setSensitivity(val)}
                min={1}
                max={5}
                step={1}
                className="mt-2"
              />
            </div>

            {/* Status message */}
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-primary-foreground font-medium">설명 문구</span>
              <Switch
                checked={showStatusMessage}
                onCheckedChange={setShowStatusMessage}
              />
            </div>

            {/* Alarm duration */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-primary-foreground font-medium">경보 지속시간</span>
                <span className="text-primary-foreground/70 text-sm">{alarmDuration}초</span>
              </div>
              <Slider
                value={[alarmDuration]}
                onValueChange={([val]) => setAlarmDuration(val)}
                min={10}
                max={120}
                step={10}
              />
            </div>

            {/* Alarm PIN */}
            <SettingItem
              label="경보해제 비밀번호"
              value={alarmPin.replace(/./g, "•")}
              onClick={() => {
                setTempPin(alarmPin);
                setShowPinDialog(true);
              }}
            />

            {/* Change PIN */}
            <SettingItem
              label="경보해제 비밀번호 변경"
              onClick={() => {
                setTempPin("");
                setShowPinDialog(true);
              }}
            />

            {/* Alarm sound */}
            <SettingItem
              label="경보음"
              value={selectedSound}
              onClick={() => setShowSoundDialog(true)}
            />

            {/* Alert settings */}
            <div className="px-4 py-4">
              <span className="text-primary-foreground font-medium block mb-3">경보 알림 설정</span>
              <div className="space-y-3 pl-2">
                <AlertToggle
                  label="노트북 움직임 감지 알림"
                  checked={alerts.motion}
                  onChange={(checked) => setAlerts({ ...alerts, motion: checked })}
                />
                <AlertToggle
                  label="노트북 커버 열림/닫힘 알림"
                  checked={alerts.lidOpen}
                  onChange={(checked) => setAlerts({ ...alerts, lidOpen: checked })}
                />
                <AlertToggle
                  label="노트북 전원 연결 해제 알림"
                  checked={alerts.powerDisconnect}
                  onChange={(checked) => setAlerts({ ...alerts, powerDisconnect: checked })}
                />
              </div>
            </div>
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
              <Button variant="outline" onClick={() => setShowNicknameDialog(false)} className="flex-1">
                취소
              </Button>
              <Button onClick={handleSaveNickname} className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">
                변경
              </Button>
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
                    if (num === "del") {
                      setTempPin(tempPin.slice(0, -1));
                    } else if (num !== null && tempPin.length < 4) {
                      setTempPin(tempPin + num);
                    }
                  }}
                  disabled={num === null}
                  className={`h-12 rounded-lg font-bold text-lg ${
                    num === null
                      ? "invisible"
                      : "bg-primary-foreground/10 text-primary-foreground active:bg-primary-foreground/20"
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
                onClick={() => {
                  setSelectedSound(sound);
                  setShowSoundDialog(false);
                }}
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

interface SettingItemProps {
  label: string;
  value?: string;
  onClick?: () => void;
}

const SettingItem = ({ label, value, onClick }: SettingItemProps) => (
  <button
    onClick={onClick}
    className="flex items-center justify-between w-full px-4 py-4 text-left"
  >
    <span className="text-primary-foreground font-medium">{label}</span>
    <div className="flex items-center gap-2">
      {value && <span className="text-primary-foreground/70">{value}</span>}
      <ChevronRight className="w-5 h-5 text-primary-foreground/50" />
    </div>
  </button>
);

interface AlertToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const AlertToggle = ({ label, checked, onChange }: AlertToggleProps) => (
  <div className="flex items-center justify-between">
    <span className="text-primary-foreground/80 text-sm">{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export default SettingsPage;
