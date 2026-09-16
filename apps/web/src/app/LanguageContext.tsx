import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import i18n, {
  DEFAULT_LANGUAGE,
  ensureLanguageLoaded,
  getStoredLanguage,
  storeLanguage,
  type SupportedLanguage,
} from './i18n';

interface LanguageContextValue {
  language: SupportedLanguage;
  direction: 'rtl' | 'ltr';
  setLanguage: (lang: SupportedLanguage) => void;
  ready: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<SupportedLanguage>(getStoredLanguage());
  const [direction, setDirection] = useState<'rtl' | 'ltr'>(language === 'ar' ? 'rtl' : 'ltr');
  // `ready` is derived (never reset synchronously inside the load effect) —
  // true only once `loadedLanguage` (set inside the async `.then` callback
  // below, an allowed "external system" update, per this Developer agent's
  // report on the newer eslint-plugin-react-hooks set-state-in-effect rule)
  // matches the currently-selected `language`.
  const [loadedLanguage, setLoadedLanguage] = useState<SupportedLanguage | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureLanguageLoaded(language).then((dir) => {
      if (cancelled) return;
      setDirection(dir);
      void i18n.changeLanguage(language);
      setLoadedLanguage(language);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const ready = loadedLanguage === language;

  // Keep the <html> dir/lang attributes in sync (screen readers, native
  // form control mirroring, and this Developer agent's manual RTL/LTR
  // verification both rely on this rather than only the MUI theme).
  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language;
  }, [direction, language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      direction,
      ready,
      setLanguage: (lang) => {
        storeLanguage(lang);
        setLanguageState(lang);
      },
    }),
    [language, direction, ready],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage() must be used within <LanguageProvider>');
  return ctx;
}

export { DEFAULT_LANGUAGE };
