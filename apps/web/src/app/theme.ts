import createCache, { type EmotionCache } from '@emotion/cache';
import type { ThemePack } from '@papp/shared-types';
import { alpha, createTheme, lighten, type Theme } from '@mui/material/styles';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { API_BASE_URL } from '../shared/api/httpClient';

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

/**
 * The built-in look, expressed as a theme pack so the default, installed
 * packs and dark mode all go through ONE code path. Light values are the
 * platform's original colors; shell `sidebar`.
 */
export const BUILT_IN_THEME: ThemePack = {
  key: 'default',
  version: '1.0.0',
  name: { ar: 'الافتراضي', en: 'Default' },
  shell: 'sidebar',
  radius: 8,
  fonts: {
    ar: '"Segoe UI", "Noto Kufi Arabic", Tahoma, Arial, sans-serif',
    en: '"Segoe UI", Roboto, Arial, sans-serif',
  },
  light: {
    primary: '#1c4b82', primaryContrast: '#ffffff', secondary: '#8a5a1c',
    background: '#f5f7fa', surface: '#ffffff', text: '#1d2733', textMuted: '#5b6877',
    border: '#dde3ea', hero: '#e3edf8', headerBg: '#1c4b82', headerText: '#ffffff',
    success: '#2e7d32', warning: '#8a5a00', error: '#c62828', info: '#1565c0',
  },
  dark: {
    primary: '#6fa3e0', primaryContrast: '#0b1726', secondary: '#d9a35a',
    background: '#10161f', surface: '#18202b', text: '#e8edf5', textMuted: '#9aa8bd',
    border: '#2b3646', hero: '#1a2a40', headerBg: '#142133', headerText: '#ffffff',
    success: '#7fdc9d', warning: '#f3cd72', error: '#ff9a9d', info: '#9cc1fa',
  },
};

/** A pack that ships no dark palette still gets a usable dark mode: neutral dark surfaces plus the pack's own (lightened) accents. */
function deriveDarkPalette(light: ThemePack['light']): ThemePack['light'] {
  return {
    ...light,
    primary: lighten(light.primary, 0.35),
    primaryContrast: '#0b1220',
    secondary: lighten(light.secondary, 0.35),
    background: '#10161f', surface: '#18202b', text: '#e8edf5', textMuted: '#9aa8bd',
    border: '#2b3646', hero: alpha(lighten(light.primary, 0.2), 0.18), headerBg: '#142133', headerText: '#ffffff',
    success: '#7fdc9d', warning: '#f3cd72', error: '#ff9a9d', info: '#9cc1fa',
  };
}

export function createAppTheme(direction: 'rtl' | 'ltr', pack: ThemePack | null = null, dark = false): Theme {
  // A theme pack is data only (packages/shared-types/src/appearance.ts):
  // palette + fonts + radius + shell. `dark` is the already-resolved mode
  // (user choice or OS setting, see ColorModeContext).
  const active = pack ?? BUILT_IN_THEME;
  const c = dark ? (active.dark ?? deriveDarkPalette(active.light)) : active.light;
  const border = `1px solid ${c.border}`;
  const radius = active.radius;
  // A soft tint of the accent: table headers, hover rows, selected rows.
  const tint = alpha(c.primary, dark ? 0.14 : 0.08);
  // The header picture is a file in the theme pack (never hardcoded here). The
  // overlay keeps the brand/actions legible: solid at the start edge, fading to
  // show the picture; it follows the reading direction.
  const headerPicture = active.headerImage
    ? `linear-gradient(${direction === 'rtl' ? 'to left' : 'to right'}, ${c.headerBg} 0%, ${alpha(c.headerBg, 0.9)} 30%, ${alpha(c.headerBg, 0.5)} 100%), url("${API_BASE_URL}/appearance/themes/${active.key}/assets/${active.headerImage}")`
    : undefined;

  return createTheme({
    direction,
    palette: {
      mode: dark ? 'dark' : 'light',
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
      fontFamily: direction === 'rtl' ? active.fonts.ar : active.fonts.en,
      button: { textTransform: 'none', fontWeight: 700 },
      h4: { fontWeight: 800 },
      h5: { fontWeight: 800 },
      h6: { fontWeight: 700 },
    },
    shape: { borderRadius: radius },
    mixins: { toolbar: { minHeight: 64, '@media (min-width:600px)': { minHeight: 72 } } },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { backgroundColor: c.background } } },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: c.headerBg,
            color: c.headerText,
            borderBottom: `3px solid ${alpha(c.primary, 0.9)}`,
            ...(headerPicture ? { backgroundImage: headerPicture, backgroundSize: 'cover', backgroundPosition: 'center bottom', backgroundRepeat: 'no-repeat' } : {}),
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, outlined: { border, borderRadius: radius } } },
      MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: radius, border } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: radius + 2 } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: Math.max(radius - 2, 4), backgroundColor: c.surface } } },
      MuiButton: { styleOverrides: { root: { borderRadius: Math.max(radius - 4, 4) } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: c.surface, borderColor: c.border } } },
      MuiTableContainer: { styleOverrides: { root: { border, borderRadius: radius } } },
      MuiTableHead: { styleOverrides: { root: { backgroundColor: tint } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: c.border }, head: { fontWeight: 800, color: c.text } } },
      MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: tint } } } },
      MuiTab: { styleOverrides: { root: { fontWeight: 700 } } },
    },
  });
}
