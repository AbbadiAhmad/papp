import { apiClient } from './httpClient';
import type { PublicPermission } from './types';

/**
 * `list()`/`getRoleGrants`/`setRoleGrants` all delegate to
 * `PermissionsPageGuard` (D12, ARCHITECTURE.md §7.4) — `admin` bypasses
 * regardless of its own grants; every other role still needs the real
 * `permissions.view`/`permissions.grant` code. `getMine()` (`GET
 * /permissions/me`) is a SEPARATE, self-scoped endpoint gated by
 * `permissions.view_my` (migration 0010) — no D12 bypass, no admin
 * special-casing, just the caller's own real grants — backing the reduced
 * "My Permissions" page rather than the full admin matrix.
 */
export const permissionsApi = {
  list: () => apiClient.get<PublicPermission[]>('/permissions').then((r) => r.data),
  getMine: () => apiClient.get<PublicPermission[]>('/permissions/me').then((r) => r.data),
  getRoleGrants: (roleId: string) => apiClient.get<string[]>(`/permissions/roles/${roleId}/grants`).then((r) => r.data),
  setRoleGrants: (roleId: string, permissionCodes: string[]) =>
    apiClient.put<string[]>(`/permissions/roles/${roleId}/grants`, { permissionCodes }).then((r) => r.data),
};
