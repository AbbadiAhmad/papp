import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/app/i18n';
import coreEn from '../../api/src/core/i18n/locales/en.json';
import { NotificationsComposePage } from '../src/core/notifications/NotificationsComposePage';
import { notificationsApi } from '../src/shared/api/notifications';

vi.mock('../src/shared/api/notifications', () => ({ notificationsApi: { send: vi.fn() } }));
vi.mock('../src/shared/api/roles', () => ({
  rolesApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'role-a', code: 'role_a', nameI18nKey: 'test.fixture.role_a', isSystem: true, createdAt: '', updatedAt: '' },
      { id: 'role-b', code: 'role_b', nameI18nKey: 'test.fixture.role_b', isSystem: true, createdAt: '', updatedAt: '' },
    ]),
  },
}));
vi.mock('../src/shared/api/users', () => ({
  usersApi: { list: vi.fn().mockResolvedValue([{ id: 'user-1', name: 'Aisha', email: 'a@x.test' }]) },
}));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', coreEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.mocked(notificationsApi.send).mockReset().mockResolvedValue({ id: 'n1', recipientCount: 1, emailedCount: 0 });
});

async function pickTarget(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Target/ }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

/**
 * Roles chosen, then the target switched to a specific user and back: the
 * role choice is remembered in the UI, but a send only ever carries the
 * CURRENTLY selected target type's value.
 */
describe('NotificationsComposePage target selection', () => {
  it('sends only the active target type, even after switching away and back', async () => {
    render(
      <MemoryRouter>
        <NotificationsComposePage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByLabelText(/^Body/), { target: { value: 'Body' } });

    // 1. roles: pick role-a
    await pickTarget('A specific role');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Roles/ }));
    fireEvent.click(await screen.findByRole('option', { name: /role_a/ }));

    // 2. switch to a user and choose them
    await pickTarget('A specific user');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /User/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Aisha/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notificationsApi.send).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notificationsApi.send).mock.calls[0][0]).toMatchObject({ targetType: 'user', targetId: 'user-1', targetIds: undefined });

    // 3. back to roles: the earlier role selection is still shown and is what gets sent now
    await pickTarget('A specific role');
    expect(within(screen.getByRole('combobox', { name: /Roles/ }).closest('.MuiAutocomplete-root') as HTMLElement).getByText(/role_a/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notificationsApi.send).toHaveBeenCalledTimes(2));
    expect(vi.mocked(notificationsApi.send).mock.calls[1][0]).toMatchObject({ targetType: 'role', targetIds: ['role-a'], targetId: undefined });

    // 4. all users: neither the role list nor the user id is sent
    await pickTarget('All users');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notificationsApi.send).toHaveBeenCalledTimes(3));
    expect(vi.mocked(notificationsApi.send).mock.calls[2][0]).toMatchObject({ targetType: 'all_users', targetId: undefined, targetIds: undefined });
  });
});
