import { useMediaQuery } from '@mui/material';
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

export type ColorModePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'papp:color-mode';
const ORDER: ColorModePreference[] = ['system', 'light', 'dark'];

/** Per-device preference (like the language choice). Wrapped: storage can throw (private mode, blocked site data). */
export function getStoredColorMode(): ColorModePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function storeColorMode(mode: ColorModePreference): void {
  try {
    if (mode === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not persisted; still applies for this page view.
  }
}

/** `system` follows the OS; the resolved boolean is what the MUI theme is built from. */
export function resolveDark(preference: ColorModePreference, systemPrefersDark: boolean): boolean {
  return preference === 'dark' || (preference === 'system' && systemPrefersDark);
}

interface ColorModeValue {
  preference: ColorModePreference;
  dark: boolean;
  setPreference: (mode: ColorModePreference) => void;
  /** system -> light -> dark -> system */
  cycle: () => void;
}

const ColorModeContext = createContext<ColorModeValue>({ preference: 'system', dark: false, setPreference: () => undefined, cycle: () => undefined });

export function ColorModeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ColorModePreference>(getStoredColorMode);
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const setPreference = useCallback((mode: ColorModePreference) => {
    storeColorMode(mode);
    setPreferenceState(mode);
  }, []);
  const cycle = useCallback(() => {
    setPreferenceState((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      storeColorMode(next);
      return next;
    });
  }, []);

  const value = useMemo<ColorModeValue>(
    () => ({ preference, dark: resolveDark(preference, systemPrefersDark), setPreference, cycle }),
    [preference, systemPrefersDark, setPreference, cycle],
  );
  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): ColorModeValue {
  return useContext(ColorModeContext);
}
