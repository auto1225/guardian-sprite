import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, Monitor, CheckCircle } from "lucide-react";
import meercopCharacter from "@/assets/meercop-character.png";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    // Listen for install prompt
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
    <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/90 backdrop-blur-sm rounded-3xl p-8 shadow-xl">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img 
            src={meercopCharacter} 
            alt="MeerCOP" 
            className="w-32 h-32 object-contain"
          />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">
          MeerCOP 설치하기
        </h1>
        <p className="text-center text-gray-600 mb-8">
          노트북 도난 방지 앱을 설치하세요
        </p>

        {isInstalled ? (
          <div className="text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-800">
              이미 설치되어 있습니다!
            </p>
            <p className="text-gray-600 mt-2">
              홈 화면에서 MeerCOP을 실행하세요.
            </p>
          </div>
        ) : isIOS ? (
          <div className="space-y-4">
            <div className="bg-sky-50 rounded-xl p-4">
              <h3 className="font-medium text-gray-800 mb-3">
                iOS에서 설치하기
              </h3>
              <ol className="space-y-3 text-sm text-gray-600">
                <li className="flex items-start gap-3">
                  <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                    1
                  </span>
                  <span>Safari 브라우저 하단의 <strong>공유</strong> 버튼을 탭하세요</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                    2
                  </span>
                  <span>스크롤하여 <strong>"홈 화면에 추가"</strong>를 탭하세요</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                    3
                  </span>
                  <span>오른쪽 상단의 <strong>"추가"</strong>를 탭하세요</span>
                </li>
              </ol>
            </div>
          </div>
        ) : deferredPrompt ? (
          <Button 
            onClick={handleInstall}
            className="w-full h-14 text-lg bg-primary hover:bg-primary/90"
          >
            <Download className="w-5 h-5 mr-2" />
            앱 설치하기
          </Button>
        ) : (
          <div className="text-center text-gray-600">
            <p className="mb-4">
              브라우저 메뉴에서 "앱 설치" 또는 "홈 화면에 추가"를 선택하세요.
            </p>
          </div>
        )}

        {/* Features */}
        <div className="mt-8 space-y-3">
          <h3 className="font-medium text-gray-800 text-center mb-4">
            주요 기능
          </h3>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Monitor className="w-5 h-5 text-primary flex-shrink-0" />
            <span>노트북 실시간 모니터링</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Smartphone className="w-5 h-5 text-primary flex-shrink-0" />
            <span>스마트폰으로 원격 제어</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
            <span>오프라인에서도 작동</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Install;