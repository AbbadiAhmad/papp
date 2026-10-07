import { apiClient } from './httpClient';
import type { PublicSession, PurgeResult } from './types';

export const sessionsApi = {
  getMine: () => apiClient.get<PublicSession[]>('/sessions/me').then((r) => r.data),
  getForUser: (userId: string) => apiClient.get<PublicSession[]>(`/sessions/user/${userId}`).then((r) => r.data),
  purge: (cutoffDate: string) => apiClient.post<PurgeResult>('/sessions/purge', { cutoffDate }).then((r) => r.data),
  revoke: (id: string) => apiClient.delete<void>(`/sessions/${id}`).then((r) => r.data),
};
