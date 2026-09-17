import { apiClient } from './httpClient';
import type { FrontendModuleManifest, PublicModuleEntry } from './types';

export const modulesApi = {
  list: () => apiClient.get<PublicModuleEntry[]>('/modules').then((r) => r.data),
  /** `@Public()` on the backend (root DECISIONS.md D78) — reachable with no Authorization header, used by the anonymous route tree too. */
  getFrontendManifest: () => apiClient.get<FrontendModuleManifest[]>('/modules/frontend-manifest').then((r) => r.data),
  install: (key: string) => apiClient.post<PublicModuleEntry>('/modules/install', { key }).then((r) => r.data),
  upgrade: (key: string) => apiClient.post<PublicModuleEntry>(`/modules/${key}/upgrade`).then((r) => r.data),
  uninstall: (key: string, dropData: boolean) =>
    apiClient.post<PublicModuleEntry>(`/modules/${key}/uninstall`, { dropData }).then((r) => r.data),
};
