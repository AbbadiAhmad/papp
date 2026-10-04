import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/app/i18n';
// `core.auth.*` keys are backend-owned — see RegisterPage.test.tsx's
// matching comment for why this is seeded directly instead of fetched.
import authEn from '../../api/src/core/i18n/locales/en.json';
import { LoginPage } from '../src/core/auth/LoginPage';
import * as authApi from '../src/shared/api/auth';

/**
 * D41 follow-up: LoginPage's "Don't have an account? Create one" link is
 * gated by GET /auth/registration-status (@Public(), UX-only — see
 * LoginPage.tsx's own docblock). Covers both states plus the fail-closed
 * default while that call is pending/erroring.
 */
vi.mock('../src/app/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

vi.mock('../src/shared/api/auth', () => ({
  getRegistrationStatus: vi.fn(),
}));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', authEn, true, true);
  await i18n.changeLanguage('en');
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('<LoginPage />', () => {
  it('shows the register link once the status check reports self-registration is open', async () => {
    vi.mocked(authApi.getRegistrationStatus).mockResolvedValue({ allowSelfRegistration: true });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Create an account' });
    expect(link).toHaveAttribute('href', '/register');
  });

  it('hides the register link when self-registration is off', async () => {
    vi.mocked(authApi.getRegistrationStatus).mockResolvedValue({ allowSelfRegistration: false });
    renderPage();

    await waitFor(() => expect(authApi.getRegistrationStatus).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('fails closed (no link) if the status check itself errors', async () => {
    vi.mocked(authApi.getRegistrationStatus).mockRejectedValue(new Error('network error'));
    renderPage();

    await waitFor(() => expect(authApi.getRegistrationStatus).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });
});
