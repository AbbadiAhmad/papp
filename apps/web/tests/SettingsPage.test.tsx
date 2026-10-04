import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/app/i18n';
// `core.settings.*`/`core.auth.*` keys are backend-owned — see
// RegisterPage.test.tsx's matching comment for why this is seeded
// directly instead of fetched over a network the test has none of.
import coreEn from '../../api/src/core/i18n/locales/en.json';
import { SettingsPage } from '../src/core/settings/SettingsPage';
import { settingsApi } from '../src/shared/api/settings';
import { rolesApi } from '../src/shared/api/roles';
import type { PublicRole } from '../src/shared/api/types';

/**
 * D91: self-registration's role dropdown — the admin-configurable
 * replacement for AuthService's old hardcoded "reader". Covers: the
 * dropdown is populated from the real role list (not just the four base
 * roles), picking "no role" + enabling is blocked client-side before any
 * API call, and a successful save sends both fields together.
 */
vi.mock('../src/shared/api/settings', () => ({
  settingsApi: {
    // SettingsPage mounts PasswordPolicyTab (tab 0) on first render
    // regardless of which tab is clicked afterward — every tab's query
    // needs a resolving mock, not just the two this test actually exercises.
    getPasswordPolicy: vi.fn().mockResolvedValue({
      minLength: 8,
      requireLetter: true,
      requireNumber: true,
      maxFailedAttempts: 5,
      lockoutMinutes: 15,
    }),
    updatePasswordPolicy: vi.fn(),
    getRegistration: vi.fn(),
    updateRegistration: vi.fn(),
  },
}));

vi.mock('../src/shared/api/roles', () => ({
  rolesApi: {
    list: vi.fn(),
  },
}));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', coreEn, true, true);
  await i18n.changeLanguage('en');
});

// Deliberately NOT core.roles.admin/reader (real seeded i18n keys the
// loaded backend bundle resolves to actual text) — these fixture roles
// use made-up keys that stay unresolved, so the test can assert on the
// literal key unambiguously and prove the dropdown lists whatever
// rolesApi.list() returns, not a fixed built-in set.
const ROLES: PublicRole[] = [
  { id: 'role-a', code: 'role_a', nameI18nKey: 'test.fixture.role_a', isSystem: true, createdAt: '', updatedAt: '' },
  { id: 'role-b', code: 'role_b', nameI18nKey: 'test.fixture.role_b', isSystem: false, createdAt: '', updatedAt: '' },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

async function openRegistrationTab() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Self-Registration' }));
}

describe('<SettingsPage /> Self-Registration tab', () => {
  it('populates the role dropdown from the real role list, not a fixed set', async () => {
    vi.mocked(settingsApi.getRegistration).mockResolvedValue({ allowSelfRegistration: false, selfRegistrationRoleCode: null });
    vi.mocked(rolesApi.list).mockResolvedValue(ROLES);
    renderPage();
    await openRegistrationTab();

    const select = await screen.findByLabelText('Role assigned to new accounts');
    fireEvent.mouseDown(select);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('test.fixture.role_a')).toBeInTheDocument();
    expect(within(listbox).getByText('test.fixture.role_b')).toBeInTheDocument();
  });

  it('blocks enabling with no role selected, client-side, before calling the API', async () => {
    vi.mocked(settingsApi.getRegistration).mockResolvedValue({ allowSelfRegistration: false, selfRegistrationRoleCode: null });
    vi.mocked(rolesApi.list).mockResolvedValue(ROLES);
    renderPage();
    await openRegistrationTab();

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Pick a role before enabling self-registration')).toBeInTheDocument();
    expect(settingsApi.updateRegistration).not.toHaveBeenCalled();
  });

  it('saves allow + the selected role code together', async () => {
    vi.mocked(settingsApi.getRegistration).mockResolvedValue({ allowSelfRegistration: false, selfRegistrationRoleCode: null });
    vi.mocked(rolesApi.list).mockResolvedValue(ROLES);
    vi.mocked(settingsApi.updateRegistration).mockResolvedValue({ allowSelfRegistration: true, selfRegistrationRoleCode: 'role_b' });
    renderPage();
    await openRegistrationTab();

    fireEvent.click(await screen.findByRole('checkbox'));
    const select = screen.getByLabelText('Role assigned to new accounts');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('test.fixture.role_b'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(settingsApi.updateRegistration).toHaveBeenCalledWith(true, 'role_b'));
  });

  it('loading an already-configured role preselects it in the dropdown', async () => {
    vi.mocked(settingsApi.getRegistration).mockResolvedValue({ allowSelfRegistration: true, selfRegistrationRoleCode: 'role_b' });
    vi.mocked(rolesApi.list).mockResolvedValue(ROLES);
    renderPage();
    await openRegistrationTab();

    expect(await screen.findByText('test.fixture.role_b')).toBeInTheDocument();
  });
});
