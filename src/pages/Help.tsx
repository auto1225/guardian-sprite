import { forwardRef, useRef } from "react";
import { ArrowLeft, Shield, ShieldCheck, Monitor, Camera, MapPin, Bell, Settings, Smartphone, Laptop, AlertTriangle, HelpCircle, Download, Wifi, Users, Lock, MessageSquare, Crown, Clock, Image } from "lucide-react";
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

const SectionTitle = forwardRef<HTMLDivElement, { id?: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode }>(({ id, icon: Icon, children }, ref) => (
  <div ref={ref} id={id} className="flex items-center gap-2 mb-3 scroll-mt-4">
    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'hsla(52, 100%, 60%, 0.2)' }}>
      <Icon className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
    </div>
    <h2 className="text-white font-bold text-base">{children}</h2>
  </div>
));
SectionTitle.displayName = "SectionTitle";

const Card = forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) => (
  <div ref={ref} className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl p-4 mb-3">
    {children}
  </div>
));
Card.displayName = "Card";

const SubTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-white font-semibold text-sm mb-2">{children}</h3>
);

const Desc = ({ children, html }: { children?: React.ReactNode; html?: string }) => {
  const content = html ?? (typeof children === 'string' ? children : undefined);
  if (content) return <p className="text-white/80 text-sm leading-relaxed mb-3 whitespace-pre-line" dangerouslySetInnerHTML={{ __html: content }} />;
  return <p className="text-white/80 text-sm leading-relaxed mb-3 whitespace-pre-line">{children}</p>;
};

const TOC_SECTIONS = [
  { id: "sec-1", icon: Shield, key: "appIntroTitle" },
  { id: "sec-2", icon: Download, key: "gettingStarted" },
  { id: "sec-3", icon: Smartphone, key: "mainScreen" },
  { id: "sec-4", icon: ShieldCheck, key: "monitoringFeature" },
  { id: "sec-5", icon: AlertTriangle, key: "alertTitle" },
  { id: "sec-6", icon: Camera, key: "cameraFeature" },
  { id: "sec-7", icon: MapPin, key: "locationTracking" },
  { id: "sec-8", icon: Wifi, key: "networkInfo" },
  { id: "sec-9", icon: Settings, key: "settingsTitle" },
  { id: "sec-10", icon: Users, key: "deviceManage" },
  { id: "sec-11", icon: Smartphone, key: "sideMenuTitle" },
  { id: "sec-12", icon: Lock, key: "remoteCommands" },
  { id: "sec-13", icon: Image, key: "photoHistory" },
  { id: "sec-14", icon: Bell, key: "alertHistory" },
  { id: "sec-15", icon: Bell, key: "pushNotification" },
  { id: "sec-16", icon: Crown, key: "planInfo" },
  { id: "sec-17", icon: Clock, key: "licenseExpired" },
];

const HelpPage = forwardRef<HTMLDivElement, HelpPageProps>(({ isOpen = true, onClose }, ref) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      ref={ref}
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 alert-history-scroll">
        {/* App Introduction */}
        <div className="flex flex-col items-center text-center mb-2">
          <img src={meercopCharacter} alt="MeerCOP" className="w-20 h-20 object-contain mb-2" />
          <h1 className="text-white font-black text-xl">MeerCOP</h1>
          <p className="text-white/70 text-sm mt-1">{t("help.appIntro")}</p>
          <p className="text-white/50 text-xs mt-1">ver 1.0.6</p>
        </div>

        {/* Table of Contents */}
        <Card>
          <h3 className="text-white font-bold text-sm mb-3">{t("help.tocTitle")}</h3>
          <div className="space-y-1.5">
            {TOC_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                onClick={() => scrollToSection(sec.id)}
                className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <sec.icon className="w-3.5 h-3.5 text-white/60 shrink-0" />
                <span className="text-white/80 text-xs">{t(`help.sections.${sec.key}`)}</span>
              </button>
            ))}
            <button
              onClick={() => scrollToSection("sec-faq")}
              className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5 text-white/60 shrink-0" />
              <span className="text-white/80 text-xs">{t("help.faq.title")}</span>
            </button>
          </div>
        </Card>

        {/* 1. App Intro */}
        <SectionTitle id="sec-1" icon={Shield}>{t("help.sections.appIntroTitle")}</SectionTitle>
        <Card>
          <Desc html={t("help.sections.appIntroContent")} />
        </Card>

        {/* 2. Getting Started */}
        <SectionTitle id="sec-2" icon={Download}>{t("help.sections.gettingStarted")}</SectionTitle>
        <Card>
          <SubTitle>{t("help.sections.createAccount")}</SubTitle>
          <Desc>{t("help.sections.createAccountDesc")}</Desc>
          <SubTitle>{t("help.sections.installLaptop")}</SubTitle>
          <Desc>{t("help.sections.installLaptopDesc")}</Desc>
          <SubTitle>{t("help.sections.installPhone")}</SubTitle>
          <Desc html={t("help.sections.installPhoneDesc")} />
          <SubTitle>{t("help.sections.installPhonePermissions")}</SubTitle>
          <Desc html={t("help.sections.installPhonePermissionsDesc")} />
        </Card>

        {/* 3. Main Screen */}
        <SectionTitle id="sec-3" icon={Smartphone}>{t("help.sections.mainScreen")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.mainScreenOverview")}</Desc>
          <SubTitle>{t("help.sections.headerArea")}</SubTitle>
          <Desc>{t("help.sections.headerAreaDesc")}</Desc>
          <SubTitle>{t("help.sections.deviceSelectionBar")}</SubTitle>
          <Desc>{t("help.sections.deviceSelectionBarDesc")}</Desc>
          <SubTitle>{t("help.sections.statusIconsTitle")}</SubTitle>
          <Desc>{t("help.sections.statusIconsDesc")}</Desc>
          <SubTitle>{t("help.sections.characterArea")}</SubTitle>
          <Desc>{t("help.sections.characterAreaDesc")}</Desc>
          <SubTitle>{t("help.sections.monitoringToggle")}</SubTitle>
          <Desc>{t("help.sections.monitoringToggleDesc")}</Desc>
          <SubTitle>{t("help.sections.camouflageMode")}</SubTitle>
          <Desc>{t("help.sections.camouflageModeDesc")}</Desc>
        </Card>

        {/* 4. Monitoring */}
        <SectionTitle id="sec-4" icon={ShieldCheck}>{t("help.sections.monitoringFeature")}</SectionTitle>
        <Card>
          <SubTitle>{t("help.sections.monitoringOn")}</SubTitle>
          <Desc>{t("help.sections.monitoringOnDesc")}</Desc>
          <SubTitle>{t("help.sections.detectionItems")}</SubTitle>
          <div className="space-y-3 ml-1">
            {(["motionDetection", "lidDetection", "keyboardMouse", "cameraMotion", "usbDevice", "powerChange", "screenTouchDetection"] as const).map((key) => (
              <div key={key}>
                <p className="text-white font-semibold text-sm">{t(`help.sections.${key}`)}</p>
                <p className="text-white/70 text-xs mt-0.5">{t(`help.sections.${key}Desc`)}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* 5. Alert */}
        <SectionTitle id="sec-5" icon={AlertTriangle}>{t("help.sections.alertTitle")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.alertDesc")}</Desc>
          <SubTitle>{t("help.sections.alertScreenTitle")}</SubTitle>
          <div className="space-y-2 ml-1 mb-3">
            <Desc html={t("help.sections.alertLiveStreaming")} />
            <Desc html={t("help.sections.alertLaptopLocation")} />
            <Desc html={t("help.sections.alertCapturedPhotos")} />
          </div>
          <Desc>{t("help.sections.alertUnavailable")}</Desc>
          <SubTitle>{t("help.sections.alertDismissTitle")}</SubTitle>
          <div className="space-y-2 ml-1 mb-3">
            <Desc html={t("help.sections.alertDismissPhone")} />
            <Desc html={t("help.sections.alertDismissComputer")} />
          </div>
          <SubTitle>{t("help.sections.alertPhotoDetail")}</SubTitle>
          <Desc>{t("help.sections.alertPhotoDetailDesc")}</Desc>
        </Card>

        {/* 6. Camera */}
        <SectionTitle id="sec-6" icon={Camera}>{t("help.sections.cameraFeature")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.cameraFeatureDesc")}</Desc>
          <div className="space-y-2 ml-1">
            {(["cameraLiveStreaming", "cameraSnapshot", "cameraRecording", "cameraPause", "cameraSwitching", "cameraAutoReconnect"] as const).map((key) => (
              <Desc key={key} html={t(`help.sections.${key}`)} />
            ))}
          </div>
        </Card>

        {/* 7. Location */}
        <SectionTitle id="sec-7" icon={MapPin}>{t("help.sections.locationTracking")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.locationTrackingDesc")}</Desc>
          <SubTitle>{t("help.sections.locationFeatures")}</SubTitle>
          <div className="space-y-1 ml-1 mb-3">
            <Desc html={t("help.sections.locationGps")} />
            <Desc html={t("help.sections.locationAutoRecord")} />
            <Desc html={t("help.sections.locationAddress")} />
          </div>
          <SubTitle>{t("help.sections.locationHistory")}</SubTitle>
          <Desc>{t("help.sections.locationHistoryDesc")}</Desc>
          <SubTitle>{t("help.sections.locationMapFeatures")}</SubTitle>
          <Desc>{t("help.sections.locationMapFeaturesDesc")}</Desc>
        </Card>

        {/* 8. Network */}
        <SectionTitle id="sec-8" icon={Wifi}>{t("help.sections.networkInfo")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.networkInfoDesc")}</Desc>
          <SubTitle>{t("help.sections.networkInfoDetails")}</SubTitle>
          <Desc>{t("help.sections.networkInfoDetailsDesc")}</Desc>
        </Card>

        {/* 9. Settings */}
        <SectionTitle id="sec-9" icon={Settings}>{t("help.sections.settingsTitle")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.settingsOverview")}</Desc>
          {(["settingNickname", "settingPin", "settingSound", "settingVolume", "settingPhoneAlarm", "settingPcPin", "settingSensor", "settingSensitivity", "settingSerial", "settingStreamingQuality", "settingLanguage", "settingDeviceType"] as const).map((key) => (
            <div key={key} className="mb-3">
              <p className="text-white font-semibold text-sm">{t(`help.sections.${key}`)}</p>
              <p className="text-white/70 text-xs mt-0.5 whitespace-pre-line">{t(`help.sections.${key}Desc`)}</p>
            </div>
          ))}
        </Card>

        {/* 10. Device Management */}
        <SectionTitle id="sec-10" icon={Users}>{t("help.sections.deviceManage")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.deviceManageDesc")}</Desc>
          <SubTitle>{t("help.sections.deviceManageFeatures")}</SubTitle>
          <div className="space-y-1 ml-1 mb-3">
            <Desc html={t("help.sections.deviceManageAdd")} />
            <Desc html={t("help.sections.deviceManageHistory")} />
            <Desc html={t("help.sections.deviceManageStatus")} />
          </div>
          <SubTitle>{t("help.sections.deviceManageSort")}</SubTitle>
          <Desc>{t("help.sections.deviceManageSortDesc")}</Desc>
          <SubTitle>{t("help.sections.deviceManageBulk")}</SubTitle>
          <Desc>{t("help.sections.deviceManageBulkDesc")}</Desc>
          <SubTitle>{t("help.sections.deviceManageDrag")}</SubTitle>
          <Desc>{t("help.sections.deviceManageDragDesc")}</Desc>
          <SubTitle>{t("help.sections.deviceManageNumber")}</SubTitle>
          <Desc>{t("help.sections.deviceManageNumberDesc")}</Desc>
        </Card>

        {/* 11. Side Menu */}
        <SectionTitle id="sec-11" icon={Smartphone}>{t("help.sections.sideMenuTitle")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.sideMenuDesc")}</Desc>
          <SubTitle>{t("help.sections.sideMenuContents")}</SubTitle>
          <Desc>{t("help.sections.sideMenuContentsDesc")}</Desc>
        </Card>

        {/* 12. Remote Commands */}
        <SectionTitle id="sec-12" icon={Lock}>{t("help.sections.remoteCommands")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.remoteCommandsDesc")}</Desc>
          <SubTitle>{t("help.sections.remoteCommandsLock")}</SubTitle>
          <Desc>{t("help.sections.remoteCommandsLockDesc")}</Desc>
          <SubTitle>{t("help.sections.remoteCommandsMessage")}</SubTitle>
          <Desc>{t("help.sections.remoteCommandsMessageDesc")}</Desc>
          <p className="text-white/50 text-xs italic">{t("help.sections.remoteCommandsOffline")}</p>
        </Card>

        {/* 13. Photo History */}
        <SectionTitle id="sec-13" icon={Image}>{t("help.sections.photoHistory")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.photoHistoryDesc")}</Desc>
        </Card>

        {/* 14. Alert History */}
        <SectionTitle id="sec-14" icon={Bell}>{t("help.sections.alertHistory")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.alertHistoryDesc")}</Desc>
        </Card>

        {/* 15. Push Notifications */}
        <SectionTitle id="sec-15" icon={Bell}>{t("help.sections.pushNotification")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.pushNotificationDesc")}</Desc>
        </Card>

        {/* 16. Plan Info */}
        <SectionTitle id="sec-16" icon={Crown}>{t("help.sections.planInfo")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.planInfoDesc")}</Desc>
        </Card>

        {/* 17. License Expired */}
        <SectionTitle id="sec-17" icon={Clock}>{t("help.sections.licenseExpired")}</SectionTitle>
        <Card>
          <Desc>{t("help.sections.licenseExpiredDesc")}</Desc>
        </Card>

        {/* FAQ */}
        <div className="mt-4" id="sec-faq">
          <SectionTitle icon={HelpCircle}>{t("help.faq.title")}</SectionTitle>
        </div>

        <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
          <Accordion type="single" collapsible className="w-full">
            {Array.from({ length: 19 }, (_, i) => i + 1).map((n) => (
              <AccordionItem key={n} value={`faq-${n}`} className="border-white/10">
                <AccordionTrigger className="px-4 text-white text-sm hover:no-underline text-left">
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
});
HelpPage.displayName = "HelpPage";

export default HelpPage;
