import { forwardRef, useRef } from "react";
import { ArrowLeft, Shield, FileText, AlertTriangle, Eye, Scale, Ban, Globe, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface LegalPageProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const SectionTitle = ({ id, icon: Icon, children }: { id?: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode }) => (
  <div id={id} className="flex items-center gap-2 mb-3 scroll-mt-4">
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

const SubTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-white font-semibold text-sm mb-2">{children}</h3>
);

const Desc = ({ children, html }: { children?: React.ReactNode; html?: string }) => {
  const content = html ?? (typeof children === 'string' ? children : undefined);
  if (content) return <p className="text-white/80 text-sm leading-relaxed mb-3 whitespace-pre-line" dangerouslySetInnerHTML={{ __html: content }} />;
  return <p className="text-white/80 text-sm leading-relaxed mb-3 whitespace-pre-line">{children}</p>;
};

const TOC_SECTIONS = [
  { id: "legal-1", icon: FileText, key: "termsOfUse" },
  { id: "legal-2", icon: Eye, key: "privacyPolicy" },
  { id: "legal-3", icon: Shield, key: "disclaimer" },
  { id: "legal-4", icon: AlertTriangle, key: "limitationOfLiability" },
  { id: "legal-5", icon: Scale, key: "intellectualProperty" },
  { id: "legal-6", icon: Ban, key: "prohibitedUse" },
  { id: "legal-7", icon: Globe, key: "thirdPartyServices" },
  { id: "legal-8", icon: RefreshCw, key: "changesAndTermination" },
];

const LegalPage = forwardRef<HTMLDivElement, LegalPageProps>(({ isOpen = true, onClose }, ref) => {
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
        isOpen ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"
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
        <h1 className="text-white font-bold text-lg">{t("legal.title")}</h1>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 alert-history-scroll">
        {/* Effective Date */}
        <Card>
          <p className="text-white/60 text-xs text-center">{t("legal.effectiveDate")}</p>
          <p className="text-white/80 text-sm text-center mt-2">{t("legal.intro")}</p>
        </Card>

        {/* Table of Contents */}
        <Card>
          <h3 className="text-white font-bold text-sm mb-3">{t("legal.tocTitle")}</h3>
          <div className="space-y-1.5">
            {TOC_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                onClick={() => scrollToSection(sec.id)}
                className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <sec.icon className="w-3.5 h-3.5 text-white/60 shrink-0" />
                <span className="text-white/80 text-xs">{t(`legal.sections.${sec.key}Title`)}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* 1. Terms of Use */}
        <SectionTitle id="legal-1" icon={FileText}>{t("legal.sections.termsOfUseTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.termsOfUseContent")} />
          <SubTitle>{t("legal.sections.termsAcceptance")}</SubTitle>
          <Desc html={t("legal.sections.termsAcceptanceDesc")} />
          <SubTitle>{t("legal.sections.termsEligibility")}</SubTitle>
          <Desc html={t("legal.sections.termsEligibilityDesc")} />
          <SubTitle>{t("legal.sections.termsAccountSecurity")}</SubTitle>
          <Desc html={t("legal.sections.termsAccountSecurityDesc")} />
        </Card>

        {/* 2. Privacy Policy */}
        <SectionTitle id="legal-2" icon={Eye}>{t("legal.sections.privacyPolicyTitle")}</SectionTitle>
        <Card>
          <SubTitle>{t("legal.sections.privacyDataCollected")}</SubTitle>
          <Desc html={t("legal.sections.privacyDataCollectedDesc")} />
          <SubTitle>{t("legal.sections.privacyDataUsage")}</SubTitle>
          <Desc html={t("legal.sections.privacyDataUsageDesc")} />
          <SubTitle>{t("legal.sections.privacyDataStorage")}</SubTitle>
          <Desc html={t("legal.sections.privacyDataStorageDesc")} />
          <SubTitle>{t("legal.sections.privacyDataSharing")}</SubTitle>
          <Desc html={t("legal.sections.privacyDataSharingDesc")} />
          <SubTitle>{t("legal.sections.privacyUserRights")}</SubTitle>
          <Desc html={t("legal.sections.privacyUserRightsDesc")} />
          <SubTitle>{t("legal.sections.privacyCookies")}</SubTitle>
          <Desc html={t("legal.sections.privacyCookiesDesc")} />
        </Card>

        {/* 3. Disclaimer */}
        <SectionTitle id="legal-3" icon={Shield}>{t("legal.sections.disclaimerTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.disclaimerContent")} />
          <SubTitle>{t("legal.sections.disclaimerNoWarranty")}</SubTitle>
          <Desc html={t("legal.sections.disclaimerNoWarrantyDesc")} />
          <SubTitle>{t("legal.sections.disclaimerAccuracy")}</SubTitle>
          <Desc html={t("legal.sections.disclaimerAccuracyDesc")} />
          <SubTitle>{t("legal.sections.disclaimerAvailability")}</SubTitle>
          <Desc html={t("legal.sections.disclaimerAvailabilityDesc")} />
          <SubTitle>{t("legal.sections.disclaimerSecurity")}</SubTitle>
          <Desc html={t("legal.sections.disclaimerSecurityDesc")} />
        </Card>

        {/* 4. Limitation of Liability */}
        <SectionTitle id="legal-4" icon={AlertTriangle}>{t("legal.sections.limitationOfLiabilityTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.limitationContent")} />
          <SubTitle>{t("legal.sections.limitationDamages")}</SubTitle>
          <Desc html={t("legal.sections.limitationDamagesDesc")} />
          <SubTitle>{t("legal.sections.limitationIndemnification")}</SubTitle>
          <Desc html={t("legal.sections.limitationIndemnificationDesc")} />
          <SubTitle>{t("legal.sections.limitationForceOverride")}</SubTitle>
          <Desc html={t("legal.sections.limitationForceOverrideDesc")} />
        </Card>

        {/* 5. Intellectual Property */}
        <SectionTitle id="legal-5" icon={Scale}>{t("legal.sections.intellectualPropertyTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.intellectualPropertyContent")} />
          <SubTitle>{t("legal.sections.ipCopyright")}</SubTitle>
          <Desc html={t("legal.sections.ipCopyrightDesc")} />
          <SubTitle>{t("legal.sections.ipTrademark")}</SubTitle>
          <Desc html={t("legal.sections.ipTrademarkDesc")} />
          <SubTitle>{t("legal.sections.ipLicense")}</SubTitle>
          <Desc html={t("legal.sections.ipLicenseDesc")} />
        </Card>

        {/* 6. Prohibited Use */}
        <SectionTitle id="legal-6" icon={Ban}>{t("legal.sections.prohibitedUseTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.prohibitedUseContent")} />
          <SubTitle>{t("legal.sections.prohibitedActivities")}</SubTitle>
          <Desc html={t("legal.sections.prohibitedActivitiesDesc")} />
          <SubTitle>{t("legal.sections.prohibitedConsequences")}</SubTitle>
          <Desc html={t("legal.sections.prohibitedConsequencesDesc")} />
        </Card>

        {/* 7. Third Party Services */}
        <SectionTitle id="legal-7" icon={Globe}>{t("legal.sections.thirdPartyServicesTitle")}</SectionTitle>
        <Card>
          <Desc html={t("legal.sections.thirdPartyContent")} />
          <SubTitle>{t("legal.sections.thirdPartyList")}</SubTitle>
          <Desc html={t("legal.sections.thirdPartyListDesc")} />
          <SubTitle>{t("legal.sections.thirdPartyDisclaimer")}</SubTitle>
          <Desc html={t("legal.sections.thirdPartyDisclaimerDesc")} />
        </Card>

        {/* 8. Changes and Termination */}
        <SectionTitle id="legal-8" icon={RefreshCw}>{t("legal.sections.changesAndTerminationTitle")}</SectionTitle>
        <Card>
          <SubTitle>{t("legal.sections.changesPolicy")}</SubTitle>
          <Desc html={t("legal.sections.changesPolicyDesc")} />
          <SubTitle>{t("legal.sections.changesTermination")}</SubTitle>
          <Desc html={t("legal.sections.changesTerminationDesc")} />
          <SubTitle>{t("legal.sections.changesGoverningLaw")}</SubTitle>
          <Desc html={t("legal.sections.changesGoverningLawDesc")} />
          <SubTitle>{t("legal.sections.changesDispute")}</SubTitle>
          <Desc html={t("legal.sections.changesDisputeDesc")} />
          <SubTitle>{t("legal.sections.changesSeverability")}</SubTitle>
          <Desc html={t("legal.sections.changesSeverabilityDesc")} />
          <SubTitle>{t("legal.sections.changesEntireAgreement")}</SubTitle>
          <Desc html={t("legal.sections.changesEntireAgreementDesc")} />
        </Card>

        {/* Contact */}
        <Card>
          <SubTitle>{t("legal.contact")}</SubTitle>
          <Desc html={t("legal.contactDesc")} />
        </Card>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-white/40 text-xs">{t("legal.footer")}</p>
        </div>
      </div>
    </div>
  );
});
LegalPage.displayName = "LegalPage";

export default LegalPage;
