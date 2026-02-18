import { ArrowLeft, Shield, ShieldCheck, Monitor, Camera, MapPin, Bell, Settings, Smartphone, Laptop, AlertTriangle, HelpCircle, ChevronDown, Users, Download, Volume2, Eye, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import meercopCharacter from "@/assets/meercop-character.png";

interface HelpPageProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const SectionTitle = ({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'hsla(52, 100%, 60%, 0.2)' }}>
      <Icon className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
    </div>
    <h2 className="text-white font-bold text-base">{children}</h2>
  </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl p-4 mb-3">
    {children}
  </div>
);

const HelpPage = ({ isOpen = true, onClose }: HelpPageProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      style={{
        background: 'linear-gradient(180deg, hsla(200, 70%, 50%, 1) 0%, hsla(200, 65%, 38%, 1) 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/20 shrink-0">
        <button onClick={handleClose} className="text-white hover:text-white/80 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white font-bold text-lg">{t("help.title")}</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 alert-history-scroll">
        {/* App Introduction */}
        <div className="flex flex-col items-center text-center mb-2">
          <img src={meercopCharacter} alt="MeerCOP" className="w-20 h-20 object-contain mb-2" />
          <h1 className="text-white font-black text-xl">MeerCOP</h1>
          <p className="text-white/70 text-sm mt-1">{t("help.appIntro")}</p>
          <p className="text-white/50 text-xs mt-1">ver 1.0.6</p>
        </div>

        {/* 1. 개요 */}
        <SectionTitle icon={Shield}>{t("help.sections.appIntroTitle")}</SectionTitle>
        <Card>
          <p className="text-white/90 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: t("help.sections.appIntroContent") }} />
        </Card>

        {/* 2. 시작하기 */}
        <SectionTitle icon={Download}>{t("help.sections.gettingStarted")}</SectionTitle>
        <Card>
          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.createAccount")}</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">{t("help.sections.createAccountDesc")}</p>

          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.installLaptop")}</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">{t("help.sections.installLaptopDesc")}</p>

          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.installPhone")}</h3>
          <p className="text-white/80 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: t("help.sections.installPhoneDesc") }} />
        </Card>

        {/* 3. 메인 화면 */}
        <SectionTitle icon={Smartphone}>{t("help.sections.mainScreen")}</SectionTitle>
        <Card>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Laptop className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t("help.sections.deviceSelectionBar")}</p>
                <p className="text-white/70 text-xs">{t("help.sections.deviceSelectionBarDesc")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Eye className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t("help.sections.statusIconsTitle")}</p>
                <p className="text-white/70 text-xs">{t("help.sections.statusIconsDesc")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t("help.sections.monitoringToggle")}</p>
                <p className="text-white/70 text-xs">{t("help.sections.monitoringToggleDesc")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Monitor className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{t("help.sections.camouflageMode")}</p>
                <p className="text-white/70 text-xs">{t("help.sections.camouflageModeDesc")}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* 4. 감시 기능 */}
        <SectionTitle icon={ShieldCheck}>{t("help.sections.monitoringFeature")}</SectionTitle>
        <Card>
          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.monitoringOn")}</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">{t("help.sections.monitoringOnDesc")}</p>

          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.detectionItems")}</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">{t("help.sections.motionDetection")}</strong> — {t("help.sections.motionDetectionDesc")}</li>
            <li>• <strong className="text-white">{t("help.sections.lidDetection")}</strong> — {t("help.sections.lidDetectionDesc")}</li>
            <li>• <strong className="text-white">{t("help.sections.keyboardMouse")}</strong> — {t("help.sections.keyboardMouseDesc")}</li>
            <li>• <strong className="text-white">{t("help.sections.cameraMotion")}</strong> — {t("help.sections.cameraMotionDesc")}</li>
            <li>• <strong className="text-white">{t("help.sections.usbDevice")}</strong> — {t("help.sections.usbDeviceDesc")}</li>
            <li>• <strong className="text-white">{t("help.sections.powerChange")}</strong> — {t("help.sections.powerChangeDesc")}</li>
          </ul>
        </Card>

        {/* 5. 경보 화면 */}
        <SectionTitle icon={AlertTriangle}>{t("help.sections.alertTitle")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-3">{t("help.sections.alertDesc")}</p>
          <h3 className="text-white font-semibold text-sm mb-2">{t("help.sections.alertScreenTitle")}</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">{t("help.sections.alertLiveStreaming")}</strong></li>
            <li>• <strong className="text-white">{t("help.sections.alertLaptopLocation")}</strong></li>
            <li>• <strong className="text-white">{t("help.sections.alertCapturedPhotos")}</strong></li>
          </ul>
          <p className="text-white/70 text-sm mt-3 leading-relaxed">{t("help.sections.alertUnavailable")}</p>

          <h3 className="text-white font-semibold text-sm mt-3 mb-2">{t("help.sections.alertDismissTitle")}</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">{t("help.sections.alertDismissPhone")}</strong></li>
            <li>• <strong className="text-white">{t("help.sections.alertDismissComputer")}</strong></li>
          </ul>
        </Card>

        {/* 6. 카메라 */}
        <SectionTitle icon={Camera}>{t("help.sections.cameraFeature")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">{t("help.sections.cameraFeatureDesc")}</p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">{t("help.sections.cameraLiveStreaming")}</strong></li>
            <li>• <strong className="text-white">{t("help.sections.cameraSnapshot")}</strong></li>
            <li>• <strong className="text-white">{t("help.sections.cameraSwitching")}</strong></li>
          </ul>
        </Card>

        {/* 7. 위치 추적 */}
        <SectionTitle icon={MapPin}>{t("help.sections.locationTracking")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">{t("help.sections.locationTrackingDesc")}</p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• {t("help.sections.locationGps")}</li>
            <li>• {t("help.sections.locationAutoRecord")}</li>
            <li>• {t("help.sections.locationAddress")}</li>
          </ul>
        </Card>

        {/* 8. 네트워크 정보 */}
        <SectionTitle icon={Wifi}>{t("help.sections.networkInfo")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">{t("help.sections.networkInfoDesc")}</p>
        </Card>

        {/* 9. 설정 */}
        <SectionTitle icon={Settings}>{t("help.sections.settingsTitle")}</SectionTitle>
        <Card>
          <div className="space-y-3">
            {([
              ["settingNickname", "settingNicknameDesc"],
              ["settingPin", "settingPinDesc"],
              ["settingSound", "settingSoundDesc"],
              ["settingVolume", "settingVolumeDesc"],
              ["settingSensor", "settingSensorDesc"],
              ["settingSensitivity", "settingSensitivityDesc"],
              ["settingSerial", "settingSerialDesc"],
            ] as const).map(([titleKey, descKey]) => (
              <div key={titleKey}>
                <p className="text-white font-semibold text-sm">{t(`help.sections.${titleKey}`)}</p>
                <p className="text-white/70 text-xs">{t(`help.sections.${descKey}`)}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* 10. 기기 관리 */}
        <SectionTitle icon={Users}>{t("help.sections.deviceManage")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">{t("help.sections.deviceManageDesc")}</p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• {t("help.sections.deviceManageAdd")}</li>
            <li>• {t("help.sections.deviceManageHistory")}</li>
            <li>• {t("help.sections.deviceManageStatus")}</li>
          </ul>
        </Card>

        {/* 11. 사진 경보 이력 */}
        <SectionTitle icon={Camera}>{t("help.sections.photoHistory")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">{t("help.sections.photoHistoryDesc")}</p>
        </Card>

        {/* 12. 위장 모드 */}
        <SectionTitle icon={Monitor}>{t("help.sections.camouflageDetail")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">{t("help.sections.camouflageDetailDesc")}</p>
        </Card>

        {/* 13. 푸시 알림 */}
        <SectionTitle icon={Bell}>{t("help.sections.pushNotification")}</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">{t("help.sections.pushNotificationDesc")}</p>
        </Card>

        {/* FAQ */}
        <div className="mt-4">
          <SectionTitle icon={HelpCircle}>{t("help.faq.title")}</SectionTitle>
        </div>

        <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
          <Accordion type="single" collapsible className="w-full">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <AccordionItem key={n} value={`faq-${n}`} className="border-white/10">
                <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                  {t(`help.faq.q${n}`)}
                </AccordionTrigger>
                <AccordionContent className="px-4 text-white/70 text-sm whitespace-pre-line">
                  {t(`help.faq.a${n}`)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-white/40 text-xs">{t("help.footer.copyright")}</p>
          <p className="text-white/30 text-xs mt-1">{t("help.footer.contact")}</p>
        </div>
      </div>
    </div>
  );
};

export default HelpPage;
