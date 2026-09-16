import { apiClient } from './httpClient';
import type { PublicPermission } from './types';

/**
 * `list()` (`GET /permissions`) and (indirectly, via rolesApi) `GET /roles`
 * are gated by the NORMAL `permissions.view`/`roles.view` codes — the D12
 * bypass (`PermissionsPageGuard`) applies ONLY to the two grants endpoints
 * below (`getRoleGrants`/`setRoleGrants`). See PermissionsMatrixPage's own
 * docblock and this Developer agent's final report for the backend gap this
 * causes for a genuinely zero-grant admin.
 */
export const permissionsApi = {
  list: () => apiClient.get<PublicPermission[]>('/permissions').then((r) => r.data),
  getRoleGrants: (roleId: string) => apiClient.get<string[]>(`/permissions/roles/${roleId}/grants`).then((r) => r.data),
  setRoleGrants: (roleId: string, permissionCodes: string[]) =>
    apiClient.put<string[]>(`/permissions/roles/${roleId}/grants`, { permissionCodes }).then((r) => r.data),
};
