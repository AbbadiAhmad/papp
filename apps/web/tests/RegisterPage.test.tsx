import { AxiosError } from 'axios';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/app/i18n';
// `core.auth.*` keys are backend-owned (apps/api/src/core/i18n/locales/),
// merged into i18next at runtime via ensureLanguageLoaded's GET /i18n/:lang
// fetch — see that function's own docblock: with no server running, a
// component test would otherwise render the literal key (the documented
// "visibly broken" fallback). Seed the same `en` bundle directly via the
// same public `addResourceBundle` mechanism instead of hitting a network.
import authEn from '../../api/src/core/i18n/locales/en.json';
import { RegisterPage } from '../src/core/auth/RegisterPage';
import * as authApi from '../src/shared/api/auth';

vi.mock('../src/shared/api/auth', () => ({
  register: vi.fn(),
}));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', authEn, true, true);
  await i18n.changeLanguage('en');
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

// `findByLabelText` (not `getByLabelText`) because i18next's own `init()`
// (app/i18n.ts's module-level `void i18n.use(...).init(...)`) resolves
// asynchronously — the very first render in a test file can briefly mount
// with empty labels before it settles; `findBy*`'s built-in retry absorbs
// that, same as the real app's first paint.
async function fillAndSubmit(overrides: { name?: string; email?: string; password?: string; confirmPassword?: string } = {}) {
  // Matched by accessible ROLE, not label text: the asterisk MUI appends
  // for a `required` field is a separate decorative span whose presence in
  // the computed accessible name isn't stable to assert against, and
  // "Password" vs "Confirm password" both contain "password" as a substring
  // so an exact-by-role match avoids ambiguity between the two.
  fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: overrides.name ?? 'Jane Reader' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: overrides.email ?? 'jane@example.com' } });
  // `type="password"` inputs have no accessible "textbox" role, so they
  // must be matched by label text instead. MUI's required-field asterisk is
  // literal text INSIDE the <label> ("Password *"), not a separately
  // excluded decoration — exact string matching never matches, hence the
  // regex. `^Password` (anchored, no `confirm` prefix) keeps this one from
  // also matching "Confirm password *".
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: overrides.password ?? 'ValidPass1' } });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: overrides.confirmPassword ?? 'ValidPass1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('<RegisterPage />', () => {
  it('rejects submission locally when the passwords do not match, without calling the API', async () => {
    renderPage();

    await fillAndSubmit({ password: 'ValidPass1', confirmPassword: 'Different1' });

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('submits name/email/password to authApi.register and shows the success message, without navigating or auto-login', async () => {
    vi.mocked(authApi.register).mockResolvedValue(undefined);
    renderPage();

    await fillAndSubmit({ name: 'Jane Reader', email: 'jane@example.com', password: 'ValidPass1', confirmPassword: 'ValidPass1' });

    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith('jane@example.com', 'Jane Reader', 'ValidPass1'));
    expect(await screen.findByText('Account created. You can now log in.')).toBeInTheDocument();
  });

  it('surfaces the server error (e.g. self-registration disabled) instead of a generic message', async () => {
    const response = {
      data: { message: 'Self-registration is currently disabled' },
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      config: {},
    };
    const forbiddenError = new AxiosError('Request failed', '403', undefined, undefined, response as never);
    vi.mocked(authApi.register).mockRejectedValue(forbiddenError);
    renderPage();

    await fillAndSubmit();

    expect(await screen.findByText('Self-registration is currently disabled')).toBeInTheDocument();
  });

  it('links back to /login', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });
});
