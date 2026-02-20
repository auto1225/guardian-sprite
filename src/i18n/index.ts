import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ko from "./locales/ko.json";
import en from "./locales/en.json";

// Try to restore cached translation for non-static languages on init
const CACHE_PREFIX = "meercop_i18n_";
const savedLang = localStorage.getItem("meercop_language");
const additionalResources: Record<string, { translation: unknown }> = {};

if (savedLang && savedLang !== "ko" && savedLang !== "en") {
  try {
    const cached = localStorage.getItem(`${CACHE_PREFIX}${savedLang}`);
    if (cached) {
      additionalResources[savedLang] = { translation: JSON.parse(cached) };
    }
  } catch {
    // ignore
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      ...additionalResources,
    },
    fallbackLng: "ko",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "meercop_language",
    },
  });

export default i18n;
