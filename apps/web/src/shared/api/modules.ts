import { apiClient } from './httpClient';
import type { AvailableModuleEntry, FrontendModuleManifest, PublicModuleEntry } from './types';

export const modulesApi = {
  list: () => apiClient.get<PublicModuleEntry[]>('/modules').then((r) => r.data),
  /** Authenticated, no specific permission required (root DECISIONS.md D79) — only called once logged in; the anonymous/must-change-password route trees never call this (see `usePublicModuleRoutes`). */
  getFrontendManifest: () => apiClient.get<FrontendModuleManifest[]>('/modules/frontend-manifest').then((r) => r.data),
  /** Modules on disk not yet installed/installing/upgrading — feeds the install dropdown. */
  listAvailable: () => apiClient.get<AvailableModuleEntry[]>('/modules/available').then((r) => r.data),
  install: (key: string) => apiClient.post<PublicModuleEntry>('/modules/install', { key }).then((r) => r.data),
  upgrade: (key: string) => apiClient.post<PublicModuleEntry>(`/modules/${key}/upgrade`).then((r) => r.data),
  uninstall: (key: string, dropData: boolean) =>
    apiClient.post<PublicModuleEntry>(`/modules/${key}/uninstall`, { dropData }).then((r) => r.data),
};
