import { useTranslation } from "react-i18next";
import { ShieldOff, ExternalLink } from "lucide-react";

interface LicenseExpiredOverlayProps {
  visible: boolean;
}

const LicenseExpiredOverlay = ({ visible }: LicenseExpiredOverlayProps) => {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div
        className="w-[90%] max-w-[360px] rounded-3xl p-8 text-center border border-white/20 shadow-2xl"
        style={{
          background:
            "linear-gradient(180deg, hsla(0, 70%, 35%, 0.95) 0%, hsla(0, 60%, 20%, 0.98) 100%)",
        }}
      >
        {/* Icon */}
        <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-white/10 flex items-center justify-center">
          <ShieldOff className="w-10 h-10 text-red-300" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-extrabold text-white mb-2">
          {t("license.expiredTitle")}
        </h2>

        {/* Description */}
        <p className="text-sm text-white/80 mb-6 leading-relaxed">
          {t("license.expiredDescription")}
        </p>

        {/* Renew button */}
        <a
          href="https://meercop.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-red-900 font-bold text-sm shadow-lg hover:bg-white/90 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          {t("license.renewButton")}
        </a>

        {/* Sub text */}
        <p className="text-xs text-white/50 mt-4">
          {t("license.renewNotice")}
        </p>
      </div>
    </div>
  );
};

export default LicenseExpiredOverlay;
