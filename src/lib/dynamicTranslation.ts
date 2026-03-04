import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import ko from "@/i18n/locales/ko.json";

const CACHE_PREFIX = "meercop_i18n_";
const CACHE_VERSION_KEY = "meercop_i18n_version";
// Bump this when ko.json changes to invalidate cached translations
const CURRENT_VERSION = "3";

const STATIC_LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW", "es", "fr", "de", "pt", "ru", "ar", "hi", "th", "vi", "id", "tr", "it"];

export const SUPPORTED_LANGUAGES = [
  { code: "ko", label: "한국어", flag: "🇰🇷", short: "KR" },
  { code: "en", label: "English", flag: "🇺🇸", short: "US" },
  { code: "ja", label: "日本語", flag: "🇯🇵", short: "JP" },
  { code: "zh-CN", label: "简体中文", flag: "🇨🇳", short: "CN" },
  { code: "zh-TW", label: "繁體中文", flag: "🇹🇼", short: "TW" },
  { code: "es", label: "Español", flag: "🇪🇸", short: "ES" },
  { code: "fr", label: "Français", flag: "🇫🇷", short: "FR" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", short: "DE" },
  { code: "pt", label: "Português", flag: "🇧🇷", short: "BR" },
  { code: "ru", label: "Русский", flag: "🇷🇺", short: "RU" },
  { code: "ar", label: "العربية", flag: "🇸🇦", short: "SA" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳", short: "IN" },
  { code: "th", label: "ไทย", flag: "🇹🇭", short: "TH" },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳", short: "VN" },
  { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩", short: "ID" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷", short: "TR" },
  { code: "it", label: "Italiano", flag: "🇮🇹", short: "IT" },
] as const;

function getCacheKey(lang: string): string {
  return `${CACHE_PREFIX}${lang}`;
}

function getCachedTranslation(lang: string): Record<string, unknown> | null {
  try {
    const version = localStorage.getItem(CACHE_VERSION_KEY);
    if (version !== CURRENT_VERSION) {
      // Clear all cached translations on version mismatch
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_VERSION);
      return null;
    }
    const cached = localStorage.getItem(getCacheKey(lang));
    if (cached) return JSON.parse(cached);
  } catch {
    // ignore
  }
  return null;
}

function cacheTranslation(lang: string, data: Record<string, unknown>): void {
  try {
    localStorage.setItem(getCacheKey(lang), JSON.stringify(data));
    localStorage.setItem(CACHE_VERSION_KEY, CURRENT_VERSION);
  } catch {
    // localStorage full — ignore
  }
}

let loadingLangs = new Set<string>();

export async function loadLanguage(lang: string): Promise<boolean> {
  // Static languages are already bundled
  if (STATIC_LANGS.includes(lang)) {
    await i18n.changeLanguage(lang);
    return true;
  }

  // Prevent parallel loads for same language
  if (loadingLangs.has(lang)) return false;

  // Check cache first
  const cached = getCachedTranslation(lang);
  if (cached) {
    i18n.addResourceBundle(lang, "translation", cached, true, true);
    await i18n.changeLanguage(lang);
    return true;
  }

  // Fetch from edge function
  loadingLangs.add(lang);
  try {
    const { data, error } = await supabase.functions.invoke("translate-i18n", {
      body: { sourceJson: ko, targetLang: lang },
    });

    if (error) {
      console.error("[i18n] Translation fetch failed:", error);
      return false;
    }

    if (data?.translation) {
      i18n.addResourceBundle(lang, "translation", data.translation, true, true);
      cacheTranslation(lang, data.translation);
      await i18n.changeLanguage(lang);
      return true;
    }

    return false;
  } catch (err) {
    console.error("[i18n] Translation error:", err);
    return false;
  } finally {
    loadingLangs.delete(lang);
  }
}
