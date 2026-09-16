import createCache, { type EmotionCache } from '@emotion/cache';
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

export function createAppTheme(direction: 'rtl' | 'ltr'): Theme {
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
