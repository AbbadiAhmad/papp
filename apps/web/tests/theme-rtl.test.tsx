import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../src/app/LanguageContext';
import { createAppTheme } from '../src/app/theme';

/**
 * `LanguageProvider` calls `ensureLanguageLoaded` -> `fetchI18nBundle`, a
 * real `GET /i18n/:lang` call (shared/api/i18n.ts) — mocked here so this
 * Tier 1 test needs no backend/network. `ensureLanguageLoaded` already
 * falls back to `directionFor(lang)` on a failed fetch per that module's own
 * docblock, so mocking it just makes that fallback deterministic and instant
 * instead of racing a real, always-failing connection attempt in jsdom.
 */
vi.mock('../src/shared/api/i18n', () => ({
  fetchI18nBundle: vi.fn().mockRejectedValue(new Error('no backend in tests')),
}));

const LANGUAGE_STORAGE_KEY = 'papp:lang';

function ThemedProbe() {
  const { direction, language, setLanguage } = useLanguage();
  const theme = createAppTheme(direction);
  return (
    <ThemeProvider theme={theme}>
      <div data-testid="lang">{language}</div>
      <div data-testid="theme-direction">{theme.direction}</div>
      <button onClick={() => setLanguage('en')}>switch-to-en</button>
      <button onClick={() => setLanguage('ar')}>switch-to-ar</button>
    </ThemeProvider>
  );
}

function renderProbe() {
  return render(
    <LanguageProvider>
      <ThemedProbe />
    </LanguageProvider>,
  );
}

describe('RTL/LTR direction switching (LanguageContext + MUI theme)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Arabic -> rtl on both <html dir> and the MUI theme', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');
    renderProbe();

    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(screen.getByTestId('theme-direction')).toHaveTextContent('rtl');
  });

  it('mounts as English -> ltr when the stored language is "en"', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderProbe();

    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByTestId('theme-direction')).toHaveTextContent('ltr');
  });

  it('switching language via setLanguage() flips dir and the theme direction reactively', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');
    renderProbe();
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));

    fireEvent.click(screen.getByText('switch-to-en'));

    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByTestId('theme-direction')).toHaveTextContent('ltr');

    fireEvent.click(screen.getByText('switch-to-ar'));

    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(screen.getByTestId('theme-direction')).toHaveTextContent('rtl');
  });

  it('createAppTheme sets the MUI theme.direction option directly from its argument', () => {
    expect(createAppTheme('rtl').direction).toBe('rtl');
    expect(createAppTheme('ltr').direction).toBe('ltr');
  });
});
