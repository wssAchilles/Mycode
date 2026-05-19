/**
 * Locale detection utilities for recommendation context signals.
 * Priority: user setting > Intl API > navigator.language
 */

/**
 * Detect country code from browser locale.
 * Returns ISO 3166-1 alpha-2 code (e.g., "CN", "US") or undefined.
 */
export function detectCountryCode(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const parts = locale.split('-');
    if (parts.length >= 2) {
      const region = parts[parts.length - 1].toUpperCase();
      if (/^[A-Z]{2}$/.test(region)) {
        return region;
      }
    }
  } catch {
    // Intl not available
  }

  // Fallback to navigator.language
  const navLang = navigator.language;
  if (navLang) {
    const parts = navLang.split('-');
    if (parts.length >= 2) {
      const region = parts[1].toUpperCase();
      if (/^[A-Z]{2}$/.test(region)) {
        return region;
      }
    }
  }

  return undefined;
}

/**
 * Detect language code from browser.
 * Returns ISO 639-1 code (e.g., "zh", "en") or undefined.
 */
export function detectLanguageCode(): string | undefined {
  const lang = navigator.language;
  if (lang) {
    return lang.split('-')[0].toLowerCase();
  }
  return undefined;
}

/**
 * Common country options for select inputs.
 */
export const COUNTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'CN', label: '中国' },
  { value: 'US', label: 'United States' },
  { value: 'JP', label: '日本' },
  { value: 'KR', label: '한국' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'DE', label: 'Deutschland' },
  { value: 'FR', label: 'France' },
  { value: 'RU', label: 'Россия' },
  { value: 'BR', label: 'Brasil' },
  { value: 'IN', label: 'India' },
  { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' },
  { value: 'SG', label: 'Singapore' },
  { value: 'HK', label: '香港' },
  { value: 'TW', label: '台灣' },
  { value: 'TH', label: 'ประเทศไทย' },
  { value: 'VN', label: 'Việt Nam' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'PH', label: 'Philippines' },
];

/**
 * Common language options for select inputs.
 */
export const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'ru', label: 'Русский' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
];
