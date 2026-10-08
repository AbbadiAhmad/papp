import type { MenuLayout, ThemePack } from '@papp/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { appearanceApi } from '../shared/api/appearance';
import { useAuth } from './AuthContext';

const EMPTY_LAYOUT: MenuLayout = { groups: [], hidden: [], labels: {} };

/**
 * The active theme pack. Fetched from the PUBLIC `GET /appearance/active`, so
 * the login page is themed too. `null` = the built-in look (also the state
 * while loading and if the request fails — a theme problem must never block
 * the app).
 */
const ThemePackContext = createContext<{ pack: ThemePack | null; reload: () => void }>({ pack: null, reload: () => undefined });

export function ThemePackProvider({ children }: PropsWithChildren) {
  const [pack, setPack] = useState<ThemePack | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    appearanceApi
      .getActive()
      .then((r) => !cancelled && setPack(r.theme))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);
  const value = useMemo(() => ({ pack, reload }), [pack, reload]);
  return <ThemePackContext.Provider value={value}>{children}</ThemePackContext.Provider>;
}

export function useThemePack() {
  return useContext(ThemePackContext);
}

const MenuLayoutContext = createContext<{ layout: MenuLayout; reload: () => void }>({ layout: EMPTY_LAYOUT, reload: () => undefined });

/** The admin's menu layout; only fetched once authenticated (inside AuthProvider). Falls back to the default order on any failure. */
export function MenuLayoutProvider({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const [layout, setLayout] = useState<MenuLayout>(EMPTY_LAYOUT);
  const [token, setToken] = useState(0);
  const enabled = status === 'authenticated';

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    appearanceApi
      .getMenuLayout()
      .then((r) => !cancelled && setLayout(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);
  const value = useMemo(() => ({ layout: enabled ? layout : EMPTY_LAYOUT, reload }), [enabled, layout, reload]);
  return <MenuLayoutContext.Provider value={value}>{children}</MenuLayoutContext.Provider>;
}

export function useMenuLayout() {
  return useContext(MenuLayoutContext);
}
