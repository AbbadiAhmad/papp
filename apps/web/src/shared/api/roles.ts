import { apiClient } from './httpClient';
import type { PublicRole } from './types';

export interface CreateRoleInput {
  code: string;
  nameI18nKey: string;
}

export interface UpdateRoleInput {
  nameI18nKey?: string;
}

export const rolesApi = {
  list: () => apiClient.get<PublicRole[]>('/roles').then((r) => r.data),
  getById: (id: string) => apiClient.get<PublicRole>(`/roles/${id}`).then((r) => r.data),
  listForUser: (userId: string) => apiClient.get<PublicRole[]>(`/roles/user/${userId}`).then((r) => r.data),
  create: (dto: CreateRoleInput) => apiClient.post<PublicRole>('/roles', dto).then((r) => r.data),
  update: (id: string, dto: UpdateRoleInput) => apiClient.patch<PublicRole>(`/roles/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete<void>(`/roles/${id}`).then((r) => r.data),
  assign: (roleId: string, userId: string) => apiClient.post<void>(`/roles/${roleId}/users/${userId}`).then((r) => r.data),
  unassign: (roleId: string, userId: string) => apiClient.delete<void>(`/roles/${roleId}/users/${userId}`).then((r) => r.data),
};
