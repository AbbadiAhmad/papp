import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { fetchI18nBundle } from '../shared/api/i18n';
import frontendAr from '../locales/core/ar.json';
import frontendEn from '../locales/core/en.json';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
/** D_A4/D19/D8: Arabic is the platform's default language. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ar';

const LANGUAGE_STORAGE_KEY = 'papp:lang';

/** Per-viewer convenience only (remembered UI language) — never state the app depends on being read back reliably. */
export function getStoredLanguage(): SupportedLanguage {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    // Private browsing / blocked storage — fall back silently.
  }
  return DEFAULT_LANGUAGE;
}

export function storeLanguage(lang: SupportedLanguage): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore — language just won't be remembered across reloads.
  }
}

export function directionFor(lang: string): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Two locale sources, merged: `apps/web/src/locales/core/{ar,en}.json` ships
 * frontend-only UI strings (dialog titles, table headers, form hints — no
 * backend concept to hang them off of), loaded synchronously so they're
 * available before the first paint (including the login screen). The
 * backend's own `GET /i18n/:lang` bundle (permission descriptions, role
 * names, menu labels, auth/settings copy shared with server-rendered
 * strings) is merged ON TOP once fetched (`ensureLanguageLoaded`, deep
 * merge) — a key present in both would let the backend's win, keeping one
 * source of truth for anything the backend already owns.
 */
void i18n.use(initReactI18next).init({
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  resources: {
    ar: { translation: frontendAr },
    en: { translation: frontendEn },
  },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

const loadedLanguages = new Set<string>();

/**
 * Fetches `GET /i18n/:lang` (Phase 5's I18nModule, `@Public()` — no auth
 * needed) and merges it into i18next as a resource bundle. Called at
 * startup and again on every language switch (BUILD_PLAN.md Phase 6 item 1).
 * Never throws: if the backend is unreachable (offline dev, or a component
 * test with no server running) the app still renders — react-i18next then
 * shows the literal key, which is the DELIBERATE "visibly broken" fallback
 * behavior ARCHITECTURE.md §9 specifies for a missing key, not a crash.
 */
export async function ensureLanguageLoaded(lang: SupportedLanguage): Promise<'rtl' | 'ltr'> {
  if (loadedLanguages.has(lang)) {
    return directionFor(lang);
  }
  try {
    const bundle = await fetchI18nBundle(lang);
    i18n.addResourceBundle(lang, 'translation', bundle.messages, true, true);
    loadedLanguages.add(lang);
    return bundle.direction;
  } catch {
    return directionFor(lang);
  }
}

export default i18n;
