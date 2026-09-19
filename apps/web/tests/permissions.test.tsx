import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/app/AuthContext';
import { Can, usePermission, usePermissionsLoaded } from '../src/shared/permissions';
import { usersApi } from '../src/shared/api/users';
import * as httpClient from '../src/shared/api/httpClient';
import type { PublicUser } from '../src/shared/api/types';

/**
 * `shared/permissions.tsx`'s own docblock: permission state is now real,
 * fetched once from `GET /users/me/permissions` via `AuthContext` right
 * after login — never a client-side guess, never "optimistic until a real
 * 403" the way this file used to test. These tests exercise that contract
 * directly against a real `AuthProvider`, with only the underlying API
 * calls mocked (never the hooks themselves).
 */

vi.mock('../src/shared/api/users', () => ({
  usersApi: {
    getMe: vi.fn(),
    getMyPermissions: vi.fn(),
  },
}));

const USER: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  externalId: null,
  department: null,
  mustChangePassword: false,
  isActive: true,
  lastLoginAt: null,
  defaultLandingPage: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdBy: null,
};

const mockedGetMe = vi.mocked(usersApi.getMe);
const mockedGetMyPermissions = vi.mocked(usersApi.getMyPermissions);

function Harness() {
  const loaded = usePermissionsLoaded();
  const fooAllowed = usePermission('foo.action');
  const barAllowed = usePermission('bar.action');

  return (
    <div>
      <div>{loaded ? 'loaded' : 'loading'}</div>
      {fooAllowed ? <button>foo-control</button> : null}
      <Can permission="bar.action">{barAllowed ? <button>bar-control</button> : null}</Can>
    </div>
  );
}

function renderHarness() {
  return render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

describe('usePermission / <Can> — backed by real GET /users/me/permissions', () => {
  beforeEach(() => {
    mockedGetMe.mockReset();
    mockedGetMyPermissions.mockReset();
    // AuthProvider's mount effect always tries a silent refresh first — make
    // it fail fast for every test that doesn't override it, matching "no
    // valid refresh cookie" (a fresh, un-authenticated test render).
    vi.spyOn(httpClient, 'refreshAccessToken').mockRejectedValue(new Error('no session'));
  });

  it('hides every gated control while permissions are still loading (never optimistic)', () => {
    // refreshAccessToken() never resolves in this test — status stays
    // 'initializing' briefly, then 'anonymous'; either way, nothing gated
    // is ever shown before real data says so.
    renderHarness();

    expect(screen.queryByText('foo-control')).not.toBeInTheDocument();
    expect(screen.queryByText('bar-control')).not.toBeInTheDocument();
  });

  it('shows only the controls the real permission set actually grants, once loaded', async () => {
    vi.spyOn(httpClient, 'refreshAccessToken').mockResolvedValue('access-token');
    mockedGetMe.mockResolvedValue(USER);
    mockedGetMyPermissions.mockResolvedValue(['foo.action']);

    renderHarness();

    await waitFor(() => expect(screen.getByText('loaded')).toBeInTheDocument());
    expect(screen.getByText('foo-control')).toBeInTheDocument();
    expect(screen.queryByText('bar-control')).not.toBeInTheDocument();
  });

  it('grants both controls when both codes are in the real permission set', async () => {
    vi.spyOn(httpClient, 'refreshAccessToken').mockResolvedValue('access-token');
    mockedGetMe.mockResolvedValue(USER);
    mockedGetMyPermissions.mockResolvedValue(['foo.action', 'bar.action']);

    renderHarness();

    await waitFor(() => expect(screen.getByText('loaded')).toBeInTheDocument());
    expect(screen.getByText('foo-control')).toBeInTheDocument();
    expect(screen.getByText('bar-control')).toBeInTheDocument();
  });

  it('grants neither when the real permission set is empty (zero-grant account)', async () => {
    vi.spyOn(httpClient, 'refreshAccessToken').mockResolvedValue('access-token');
    mockedGetMe.mockResolvedValue(USER);
    mockedGetMyPermissions.mockResolvedValue([]);

    renderHarness();

    await waitFor(() => expect(screen.getByText('loaded')).toBeInTheDocument());
    expect(screen.queryByText('foo-control')).not.toBeInTheDocument();
    expect(screen.queryByText('bar-control')).not.toBeInTheDocument();
  });

  it('usePermission()/<Can> throw outside an AuthProvider', () => {
    // Guards against accidentally rendering a gated page/control outside the
    // app shell's provider tree; React logs the error to the console — that
    // is expected and not asserted on here.
    function Bare() {
      usePermission('x');
      return null;
    }
    const spy = () => render(<Bare />);
    expect(spy).toThrow(/AuthProvider/);
  });
});
