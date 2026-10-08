import createCache, { type EmotionCache } from '@emotion/cache';
import type { ThemePack } from '@papp/shared-types';
import { createTheme, type Theme } from '@mui/material/styles';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

/**
 * ARCHITECTURE.md §9 / BUILD_PLAN.md Phase 6 item 1: the MUI `direction`
 * theme option drives the whole layout mirroring (drawer side, form
 * label/input order, icon flipping), and `stylis-plugin-rtl` rewrites every
 * emotion-generated CSS rule (margin/padding/border shorthand, `left`/
 * `right`) for RTL automatically — this is what makes plain MUI `sx` props
 * RTL-safe without hand-writing logical properties everywhere (custom CSS
 * outside MUI's `sx`/`styled` still must use logical properties per the
 * papp-add-feature skill).
 */
export function createEmotionCacheFor(direction: 'rtl' | 'ltr'): EmotionCache {
  return createCache({
    key: direction === 'rtl' ? 'papp-rtl' : 'papp-ltr',
    stylisPlugins: direction === 'rtl' ? [prefixer, rtlPlugin] : [prefixer],
  });
}

export function createAppTheme(direction: 'rtl' | 'ltr', pack: ThemePack | null = null, prefersDark = false): Theme {
  if (!pack) {
    // The built-in look — unchanged from before theme packs existed.
    return createTheme({
      direction,
      palette: {
        mode: 'light',
        primary: { main: '#1c4b82' },
        secondary: { main: '#8a5a1c' },
      },
      typography: {
        fontFamily:
          direction === 'rtl'
            ? '"Segoe UI", "Noto Kufi Arabic", Tahoma, Arial, sans-serif'
            : '"Segoe UI", Roboto, Arial, sans-serif',
      },
      shape: { borderRadius: 8 },
    });
  }

  // A theme pack is data only (packages/shared-types/src/appearance.ts):
  // palette + fonts + radius + shell. Dark applies only if the pack ships a
  // dark palette AND the OS asks for dark.
  const useDark = prefersDark && Boolean(pack.dark);
  const c = useDark && pack.dark ? pack.dark : pack.light;
  const border = `1px solid ${c.border}`;

  return createTheme({
    direction,
    palette: {
      mode: useDark ? 'dark' : 'light',
      primary: { main: c.primary, contrastText: c.primaryContrast },
      secondary: { main: c.secondary },
      background: { default: c.background, paper: c.surface },
      text: { primary: c.text, secondary: c.textMuted },
      divider: c.border,
      success: { main: c.success },
      warning: { main: c.warning },
      error: { main: c.error },
      info: { main: c.info },
    },
    typography: {
      fontFamily: direction === 'rtl' ? pack.fonts.ar : pack.fonts.en,
      button: { textTransform: 'none', fontWeight: 700 },
      h4: { fontWeight: 800 },
      h5: { fontWeight: 800 },
      h6: { fontWeight: 700 },
    },
    shape: { borderRadius: pack.radius },
    components: {
      MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundColor: c.headerBg, color: c.headerText } } },
      MuiPaper: { styleOverrides: { outlined: { border, borderRadius: pack.radius } } },
      MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: pack.radius, border } } },
      MuiButton: { styleOverrides: { root: { borderRadius: Math.max(pack.radius - 4, 4) } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: c.surface, borderColor: c.border } } },
    },
  });
}
