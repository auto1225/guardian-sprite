import { Check, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  BACKGROUND_PRESETS,
  getSelectedBackgroundId,
  getCustomBackground,
  selectPreset,
  saveCustomBackground,
  deleteCustomBackground,
} from "@/lib/backgroundPresets";
import mainBg from "@/assets/main-bg.png";

interface BackgroundSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBackgroundChange: () => void;
}

const BackgroundSelector = ({ open, onOpenChange, onBackgroundChange }: BackgroundSelectorProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState(getSelectedBackgroundId);
  const [customPreview, setCustomPreview] = useState<string | null>(getCustomBackground);

  const handleSelect = (id: string) => {
    selectPreset(id);
    setSelectedId(id);
    onBackgroundChange();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: t("common.error"), description: t("bg.fileTooLarge"), variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      saveCustomBackground(dataUrl);
      setCustomPreview(dataUrl);
      setSelectedId("custom");
      onBackgroundChange();
      toast({ title: t("common.saved"), description: t("bg.customSet") });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDeleteCustom = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCustomBackground();
    setCustomPreview(null);
    setSelectedId("default");
    onBackgroundChange();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border border-white/25"
        style={{ background: "hsla(200, 60%, 45%, 0.92)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
      >
        <DialogHeader>
          <DialogTitle className="text-white">{t("bg.title")}</DialogTitle>
          <DialogDescription className="text-white/70">{t("bg.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2">
          {/* Presets */}
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelect(preset.id)}
              className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-[3/4] ${
                selectedId === preset.id ? "border-yellow-400 shadow-lg" : "border-white/20 hover:border-white/40"
              }`}
            >
              {preset.id === "default" ? (
                <img src={mainBg} alt="Default" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" style={{ background: preset.value }} />
              )}
              {selectedId === preset.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Check className="w-5 h-5" style={{ color: "hsla(52, 100%, 60%, 1)" }} />
                </div>
              )}
              <span className="absolute bottom-0 left-0 right-0 text-[9px] text-white font-semibold text-center py-0.5 bg-black/40 truncate px-0.5">
                {t(preset.labelKey)}
              </span>
            </button>
          ))}

          {/* Custom image */}
          {customPreview && (
            <button
              onClick={() => handleSelect("custom")}
              className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-[3/4] ${
                selectedId === "custom" ? "border-yellow-400 shadow-lg" : "border-white/20 hover:border-white/40"
              }`}
            >
              <img src={customPreview} alt="Custom" className="w-full h-full object-cover" />
              {selectedId === "custom" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Check className="w-5 h-5" style={{ color: "hsla(52, 100%, 60%, 1)" }} />
                </div>
              )}
              <button
                onClick={handleDeleteCustom}
                className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 transition-colors hover:bg-red-500"
              >
                <X className="h-3 w-3 text-white" />
              </button>
              <span className="absolute bottom-0 left-0 right-0 text-[9px] text-white font-semibold text-center py-0.5 bg-black/40 truncate px-0.5">
                {t("bg.custom")}
              </span>
            </button>
          )}

          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/30 transition-all hover:border-white/50 hover:bg-white/5"
          >
            <Upload className="h-5 w-5 text-white/60" />
            <span className="text-[9px] text-white/60 font-semibold">{t("bg.upload")}</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </DialogContent>
    </Dialog>
  );
};

export default BackgroundSelector;
