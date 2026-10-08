import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColorModeProvider, getStoredColorMode, resolveDark, useColorMode } from '../src/app/ColorModeContext';
import { BUILT_IN_THEME, createAppTheme } from '../src/app/theme';
import { coverGradientIndex, StatusPill } from '../src/shared/ui/kit';

beforeEach(() => window.localStorage.clear());

describe('color mode', () => {
  it('system follows the OS; light/dark override it', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
  });

  it('cycles system -> light -> dark -> system and remembers the choice per device', () => {
    function Probe() {
      const { preference, cycle } = useColorMode();
      return <button onClick={cycle}>{preference}</button>;
    }
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('system');
    fireEvent.click(button);
    expect(button).toHaveTextContent('light');
    expect(getStoredColorMode()).toBe('light');
    fireEvent.click(button);
    expect(getStoredColorMode()).toBe('dark');
    fireEvent.click(button);
    expect(button).toHaveTextContent('system');
    expect(getStoredColorMode()).toBe('system');
  });

  it('an unreadable/garbage stored value falls back to system', () => {
    window.localStorage.setItem('papp:color-mode', 'purple');
    expect(getStoredColorMode()).toBe('system');
  });
});

describe('createAppTheme dark mode', () => {
  it('the built-in theme has a real dark palette', () => {
    const t = createAppTheme('ltr', null, true);
    expect(t.palette.mode).toBe('dark');
    expect(t.palette.background.default).toBe(BUILT_IN_THEME.dark!.background);
  });

  it('a pack without a dark palette still gets a dark mode, with neutral dark surfaces and its own accent', () => {
    const lightOnly = { ...BUILT_IN_THEME, key: 'light_only', dark: undefined };
    const t = createAppTheme('rtl', lightOnly, true);
    expect(t.palette.mode).toBe('dark');
    expect(t.palette.background.default).toBe('#10161f');
    expect(t.palette.primary.main).not.toBe(lightOnly.light.primary); // lightened for contrast on dark
    expect(t.direction).toBe('rtl');
  });

  it('light stays the pack light palette', () => {
    const t = createAppTheme('ltr', null, false);
    expect(t.palette.primary.main).toBe(BUILT_IN_THEME.light.primary);
  });
});

describe('shared UI kit', () => {
  it('gives a book the same cover color every time', () => {
    expect(coverGradientIndex('Dune')).toBe(coverGradientIndex('Dune'));
    const seen = new Set(['Dune', 'Emma', 'Kim', 'الأمير الصغير', 'Heidi', 'Ulysses', 'Walden', 'Beloved'].map(coverGradientIndex));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('StatusPill shows its label', () => {
    act(() => undefined);
    render(<ThemeProvider theme={createAppTheme('ltr')}><StatusPill tone="error" label="Overdue" /></ThemeProvider>);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});
