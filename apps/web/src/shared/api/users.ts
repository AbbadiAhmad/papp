import { apiClient } from './httpClient';
import type { ImportReport, PublicUser } from './types';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  externalId?: string;
  department?: string;
  mustChangePassword?: boolean;
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  externalId?: string;
  department?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  password?: string;
}

export const usersApi = {
  getMe: () => apiClient.get<PublicUser>('/users/me').then((r) => r.data),
  list: () => apiClient.get<PublicUser[]>('/users').then((r) => r.data),
  getById: (id: string) => apiClient.get<PublicUser>(`/users/${id}`).then((r) => r.data),
  create: (dto: CreateUserInput) => apiClient.post<PublicUser>('/users', dto).then((r) => r.data),
  update: (id: string, dto: UpdateUserInput) => apiClient.patch<PublicUser>(`/users/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete<void>(`/users/${id}`).then((r) => r.data),

  importPreview: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ImportReport>('/users/import/preview', form).then((r) => r.data);
  },
  importCommit: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ImportReport>('/users/import', form).then((r) => r.data);
  },
  exportUsers: () => apiClient.get<Blob>('/users/export', { responseType: 'blob' }).then((r) => r.data),
};

/** Triggers a browser download for a blob response (GET /users/export). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
