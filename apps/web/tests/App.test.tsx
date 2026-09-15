import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

/**
 * Phase 0 smoke test (docs/BUILD_PLAN.md, Tester scope): the Vite + React +
 * TS skeleton renders without crashing. App.tsx itself is a placeholder
 * until Phase 6 builds the real shell (router, MUI RTL theme, i18n, auth
 * context) — this test is intentionally shallow to match.
 */
describe('<App />', () => {
  it('renders without crashing', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'papp' })).toBeInTheDocument();
  });
});
