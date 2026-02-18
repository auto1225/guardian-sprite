import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, Monitor, CheckCircle, ArrowLeft } from "lucide-react";
import meercopCharacter from "@/assets/meercop-character.png";
import { useTranslation } from "react-i18next";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col items-center justify-center p-6 relative">
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 bg-white/15 backdrop-blur-md border border-white/25 rounded-full p-2.5 text-white active:scale-95 transition-transform shadow-lg"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="max-w-md w-full bg-white/12 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-xl">
        <div className="flex justify-center mb-6">
          <img src={meercopCharacter} alt="MeerCOP" className="w-32 h-32 object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-center text-white mb-2 drop-shadow-sm">{t("install.title")}</h1>
        <p className="text-center text-white/70 mb-8">{t("install.subtitle")}</p>

        {isInstalled ? (
          <div className="text-center">
            <CheckCircle className="w-16 h-16 text-status-active mx-auto mb-4" />
            <p className="text-lg font-medium text-white">{t("install.alreadyInstalled")}</p>
            <p className="text-white/70 mt-2">{t("install.launchFromHome")}</p>
          </div>
        ) : isIOS ? (
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-xl p-4">
              <h3 className="font-medium text-white mb-3">{t("install.iosTitle")}</h3>
              <ol className="space-y-3 text-sm text-white/80">
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0 border border-white/25">1</span>
                  <span dangerouslySetInnerHTML={{ __html: t("install.iosStep1") }} />
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0 border border-white/25">2</span>
                  <span dangerouslySetInnerHTML={{ __html: t("install.iosStep2") }} />
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0 border border-white/25">3</span>
                  <span dangerouslySetInnerHTML={{ __html: t("install.iosStep3") }} />
                </li>
              </ol>
            </div>
          </div>
        ) : deferredPrompt ? (
          <Button
            onClick={handleInstall}
            className="w-full h-14 text-lg bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/30 text-white rounded-full font-bold shadow-lg"
          >
            <Download className="w-5 h-5 mr-2" />
            {t("install.installButton")}
          </Button>
        ) : (
          <div className="text-center text-white/70">
            <p className="mb-4">{t("install.browserInstall")}</p>
          </div>
        )}

        <div className="mt-8 space-y-3">
          <h3 className="font-medium text-white text-center mb-4">{t("install.features")}</h3>
          <div className="flex items-center gap-3 text-sm text-white/80">
            <Monitor className="w-5 h-5 text-white/60 flex-shrink-0" />
            <span>{t("install.feature1")}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-white/80">
            <Smartphone className="w-5 h-5 text-white/60 flex-shrink-0" />
            <span>{t("install.feature2")}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-white/80">
            <CheckCircle className="w-5 h-5 text-white/60 flex-shrink-0" />
            <span>{t("install.feature3")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Install;
