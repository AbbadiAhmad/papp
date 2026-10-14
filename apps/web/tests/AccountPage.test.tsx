import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../src/app/i18n';
import coreEn from '../../api/src/core/i18n/locales/en.json';
import { AccountPage } from '../src/core/users/AccountPage';

/** AccountPage = read-only profile + one tab per personal page, each shown only with its permission. */

let granted: string[] = [];

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', coreEn, true, true);
  await i18n.changeLanguage('en');
});

vi.mock('../src/app/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => granted.includes(code),
    user: {
      name: 'Layla Hassan',
      email: 'layla@example.com',
      externalId: 'EMP-7',
      department: null,
      dateOfBirth: '1990-04-05',
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
  }),
}));
vi.mock('../src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('../src/core/permissions/MyPermissionsPage', () => ({ MyPermissionsPage: () => <div>my-permissions-stub</div> }));
vi.mock('../src/core/sessions/SessionsPage', () => ({ SessionsPage: () => <div>sessions-stub</div> }));
vi.mock('../src/core/users/ChangePasswordPage', () => ({ ChangePasswordPage: () => <div>change-password-stub</div> }));
vi.mock('../src/core/users/MyPreferencesPage', () => ({ MyPreferencesPage: () => <div>preferences-stub</div> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/:tab" element={<AccountPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AccountPage', () => {
  beforeEach(() => {
    granted = [];
  });

  it('shows the stored personal information read-only, with no edit controls', () => {
    renderAt('/account');
    expect(screen.getByText('Layla Hassan')).toBeInTheDocument();
    expect(screen.getByText('layla@example.com')).toBeInTheDocument();
    expect(screen.getByText('EMP-7')).toBeInTheDocument();
    expect(screen.getByText('04/05/1990')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers only the tabs the user has permission for', () => {
    granted = ['sessions.view_my'];
    renderAt('/account');
    expect(screen.getByRole('tab', { name: /my information/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /active sessions/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /change password/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /my permissions/i })).toBeNull();
  });

  it('renders the page behind a permitted tab', () => {
    granted = ['users.password.change_my'];
    renderAt('/account/password');
    expect(screen.getByText('change-password-stub')).toBeInTheDocument();
  });

  it('sends a tab the user may not open back to the profile', () => {
    renderAt('/account/sessions');
    expect(screen.getByText('layla@example.com')).toBeInTheDocument();
    expect(screen.queryByText('sessions-stub')).toBeNull();
  });
});
