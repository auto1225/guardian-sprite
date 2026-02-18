import { ChevronRight, Play, Square, Upload, VolumeX, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { getVolume as getAlarmVolume, setVolume as setAlarmVolume } from "@/lib/alarmSound";

// ── Types ──

export interface SensorSettings {
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

export type MotionSensitivity = "sensitive" | "normal" | "insensitive";

export const SENSITIVITY_MAP: Record<MotionSensitivity, { labelKey: string }> = {
  sensitive: { labelKey: "settings.sensitivity.sensitive" },
  normal: { labelKey: "settings.sensitivity.normal" },
  insensitive: { labelKey: "settings.sensitivity.insensitive" },
};

export const DEFAULT_SENSOR_SETTINGS: SensorSettings = {
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

export const ALARM_SOUNDS: { id: string; labelKey: string; freq: number[]; pattern: number[] }[] = [
  { id: "whistle", labelKey: "settings.sounds.whistle", freq: [2200, 1800], pattern: [0.15, 0.1] },
  { id: "siren", labelKey: "settings.sounds.siren", freq: [660, 880], pattern: [0.3, 0.3] },
  { id: "bird", labelKey: "settings.sounds.bird", freq: [1400, 1800, 2200], pattern: [0.1, 0.08, 0.12] },
  { id: "police", labelKey: "settings.sounds.police", freq: [600, 1200], pattern: [0.5, 0.5] },
  { id: "radio", labelKey: "settings.sounds.radio", freq: [440, 520, 600], pattern: [0.2, 0.15, 0.2] },
  { id: "quiet", labelKey: "settings.sounds.quiet", freq: [400, 500], pattern: [0.4, 0.4] },
];

// ── Shared Sub-components ──

export const SettingItem = ({ label, value, onClick }: { label: string; value?: string; onClick?: () => void }) => (
  <button onClick={onClick} className="flex items-center justify-between w-full px-4 py-4 text-left hover:bg-white/8 active:bg-white/12 transition-colors">
    <span className="text-white font-semibold text-sm">{label}</span>
    <div className="flex items-center gap-2">
      {value && <span className="text-white/80 text-sm font-medium">{value}</span>}
      <ChevronRight className="w-5 h-5 text-white/60" />
    </div>
  </button>
);

export const SensorSection = ({ children }: { children: React.ReactNode }) => (
  <div className="px-4 py-3.5">{children}</div>
);

export const SensorToggle = ({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (checked: boolean) => void;
}) => {
  // Switch is now imported at the top level
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-white font-semibold text-sm block">{label}</span>
        <span className="text-white/80 text-xs">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
};

// ── Audio Helpers ──

export async function playBuiltinSound(sound: typeof ALARM_SOUNDS[number], duration = 2, volume?: number): Promise<{ stop: () => void }> {
  const ctx = new AudioContext();
  await ctx.resume();
  const vol = volume ?? getAlarmVolume();
  
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
      gain.gain.value = vol;
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

// ── Nickname Dialog ──

export const NicknameDialog = ({ open, onOpenChange, value, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; value: string; onSave: (name: string) => void;
}) => {
  const { t } = useTranslation();
  const [tempValue, setTempValue] = useState(value);
  
  if (open && tempValue !== value) setTempValue(value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-white/25" style={{ background: 'hsla(200, 60%, 45%, 0.92)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        <DialogHeader>
          <DialogTitle className="text-white">{t("settings.nicknameDialog.title")}</DialogTitle>
          <DialogDescription className="text-white/70">{t("settings.nicknameDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            className="bg-white/15 border-white/25 text-white placeholder:text-white/40 focus:border-white/50"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 border-white/25 text-white hover:bg-white/15 bg-transparent">{t("common.cancel")}</Button>
            <Button onClick={() => onSave(tempValue)} className="flex-1 text-slate-800 font-semibold hover:opacity-90" style={{ background: 'hsla(52, 100%, 60%, 0.9)' }}>{t("common.change")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── PIN Dialog ──

export const PinDialog = ({ open, onOpenChange, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSave: (pin: string) => void;
}) => {
  const { t } = useTranslation();
  const [tempPin, setTempPin] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setTempPin(""); onOpenChange(v); }}>
      <DialogContent className="border border-white/25" style={{ background: 'hsla(200, 60%, 45%, 0.92)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        <DialogHeader>
          <DialogTitle className="text-white">{t("settings.pinDialog.title")}</DialogTitle>
          <DialogDescription className="text-white/70">{t("settings.pinDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="border-2 border-white/30 rounded-xl flex items-center justify-center text-white text-2xl font-bold"
                style={{ width: 52, height: 52, background: 'hsla(0,0%,100%,0.1)' }}
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
                className={`rounded-xl font-bold text-lg transition-all ${
                  num === null ? "invisible" : "text-white active:scale-95"
                }`}
                style={{ height: 52, background: num !== null ? 'hsla(0,0%,100%,0.12)' : undefined }}
              >
                {num === "del" ? "⌫" : num}
              </button>
            ))}
          </div>
          <Button
            onClick={() => { onSave(tempPin); setTempPin(""); }}
            disabled={tempPin.length !== 4}
            className="w-full text-slate-800 font-semibold hover:opacity-90 disabled:opacity-40"
            style={{ background: 'hsla(52, 100%, 60%, 0.9)' }}
          >
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Sound Dialog ──

export const SoundDialog = ({ open, onOpenChange, selectedSoundId, customSoundName, customSoundDataUrl, onSelectSound, onCustomUpload, deviceId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSoundId: string;
  customSoundName: string;
  customSoundDataUrl: string;
  onSelectSound: (soundId: string) => void;
  onCustomUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  deviceId: string;
}) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<{ stop: () => void } | null>(null);
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [volumePercent, setVolumePercent] = useState(() => Math.round(getAlarmVolume() * 100));

  const stopAllSounds = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (synthRef.current) { synthRef.current.stop(); synthRef.current = null; }
    setPlayingSoundId(null);
  };

  const previewSound = async (soundId: string) => {
    stopAllSounds();
    if (playingSoundId === soundId) return;
    setPlayingSoundId(soundId);

    if (soundId === "custom" && customSoundDataUrl) {
      const audio = new Audio();
      audio.volume = volumePercent / 100;
      audio.src = customSoundDataUrl;
      audioRef.current = audio;
      try { await audio.play(); } catch (e) { console.warn("Custom sound play failed:", e); }
      setTimeout(() => { audio.pause(); setPlayingSoundId(null); }, 2000);
    } else {
      const sound = ALARM_SOUNDS.find((s) => s.id === soundId);
      if (sound) {
        synthRef.current = await playBuiltinSound(sound, 2);
        setTimeout(() => stopAllSounds(), 2000);
      }
    }
  };

  const getSoundLabel = (id: string) => {
    const key = `settings.sounds.${id}` as const;
    return t(key);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) stopAllSounds(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto border border-white/25 alert-history-scroll" style={{ background: 'hsla(200, 60%, 45%, 0.92)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        <DialogHeader>
          <DialogTitle className="text-white">{t("settings.soundDialog.title")}</DialogTitle>
          <DialogDescription className="text-white/70">{t("settings.soundDialog.description")}</DialogDescription>
        </DialogHeader>

        {/* Volume slider */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-semibold text-sm">{t("settings.soundDialog.volume")}</span>
            <span className="text-white/70 text-sm font-medium">{volumePercent}%</span>
          </div>
          <div className="flex items-center gap-3">
            <VolumeX className="w-4 h-4 text-white/60 flex-shrink-0" />
            <Slider
              value={[volumePercent]}
              min={0}
              max={100}
              step={5}
              onValueChange={(vals) => {
                setVolumePercent(vals[0]);
                setAlarmVolume(vals[0] / 100);
              }}
              className="flex-1"
            />
            <Volume2 className="w-4 h-4 text-white/60 flex-shrink-0" />
          </div>
        </div>

        <div className="mb-2">
          <span className="text-white font-semibold text-sm">{t("settings.soundDialog.soundType")}</span>
        </div>

        <div className="space-y-2">
          {ALARM_SOUNDS.map((sound) => (
            <div
              key={sound.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer border ${
                selectedSoundId === sound.id ? "border-white/30 shadow-md" : "border-transparent hover:bg-white/10"
              }`}
              style={{ background: selectedSoundId === sound.id ? 'hsla(52, 100%, 60%, 0.15)' : 'hsla(0,0%,100%,0.08)' }}
              onClick={() => { onSelectSound(sound.id); stopAllSounds(); }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); previewSound(sound.id); }}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/20 transition-colors"
                style={{ background: 'hsla(0,0%,100%,0.15)' }}
              >
                {playingSoundId === sound.id ? (
                  <Square className="w-4 h-4 fill-current" style={{ color: 'hsla(52, 100%, 60%, 1)' }} />
                ) : (
                  <Play className="w-4 h-4 text-white/90 ml-0.5" />
                )}
              </button>
              <span className="text-white font-medium text-sm flex-1">{getSoundLabel(sound.id)}</span>
              {selectedSoundId === sound.id && (
                <span className="font-bold" style={{ color: 'hsla(52, 100%, 60%, 1)' }}>✓</span>
              )}
            </div>
          ))}

          {/* Custom sound */}
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer border ${
              selectedSoundId === "custom" ? "border-white/30 shadow-md" : "border-transparent hover:bg-white/10"
            }`}
            style={{ background: selectedSoundId === "custom" ? 'hsla(52, 100%, 60%, 0.15)' : 'hsla(0,0%,100%,0.08)' }}
            onClick={() => { if (customSoundDataUrl) onSelectSound("custom"); else fileInputRef.current?.click(); }}
          >
            {customSoundDataUrl ? (
              <button
                onClick={(e) => { e.stopPropagation(); previewSound("custom"); }}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/20 transition-colors"
                style={{ background: 'hsla(0,0%,100%,0.15)' }}
              >
                {playingSoundId === "custom" ? (
                  <Square className="w-4 h-4 fill-current" style={{ color: 'hsla(52, 100%, 60%, 1)' }} />
                ) : (
                  <Play className="w-4 h-4 text-white/90 ml-0.5" />
                )}
              </button>
            ) : (
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'hsla(0,0%,100%,0.15)' }}>
                <Upload className="w-4 h-4 text-white/70" />
              </div>
            )}
            <div className="flex-1">
              <span className="text-white font-medium text-sm block">
                {customSoundName || t("settings.soundDialog.customUpload")}
              </span>
              {customSoundDataUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="text-white/60 text-xs underline mt-0.5"
                >
                  {t("settings.soundDialog.chooseOther")}
                </button>
              )}
            </div>
            {selectedSoundId === "custom" && (
              <span className="font-bold" style={{ color: 'hsla(52, 100%, 60%, 1)' }}>✓</span>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={onCustomUpload}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
