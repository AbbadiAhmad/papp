import { apiClient } from './httpClient';
import type { PublicModuleEntry } from './types';

export const modulesApi = {
  list: () => apiClient.get<PublicModuleEntry[]>('/modules').then((r) => r.data),
  install: (key: string) => apiClient.post<PublicModuleEntry>('/modules/install', { key }).then((r) => r.data),
  upgrade: (key: string) => apiClient.post<PublicModuleEntry>(`/modules/${key}/upgrade`).then((r) => r.data),
  uninstall: (key: string, dropData: boolean) =>
    apiClient.post<PublicModuleEntry>(`/modules/${key}/uninstall`, { dropData }).then((r) => r.data),
};
