import { apiClient } from './httpClient';
import type { PublicPermission } from './types';

/**
 * `list()`/`getRoleGrants`/`setRoleGrants` are gated by the plain
 * `permissions.view`/`permissions.grant` codes — no special-casing, no
 * admin bypass (see `PermissionsMatrixPage`'s own docblock for why one is
 * no longer needed). `getMine()` (`GET /permissions/me`) is a SEPARATE,
 * self-scoped endpoint gated by `permissions.view_my` (migration 0010),
 * just the caller's own real grants — backing the reduced "My Permissions"
 * page rather than the full admin matrix.
 */
export const permissionsApi = {
  list: () => apiClient.get<PublicPermission[]>('/permissions').then((r) => r.data),
  getMine: () => apiClient.get<PublicPermission[]>('/permissions/me').then((r) => r.data),
  getRoleGrants: (roleId: string) => apiClient.get<string[]>(`/permissions/roles/${roleId}/grants`).then((r) => r.data),
  setRoleGrants: (roleId: string, permissionCodes: string[]) =>
    apiClient.put<string[]>(`/permissions/roles/${roleId}/grants`, { permissionCodes }).then((r) => r.data),
};
