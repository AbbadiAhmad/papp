import { apiClient } from './httpClient';
import type { AuditPage, AuditQueryParams, PurgeResult } from './types';

export const auditApi = {
  query: (params: AuditQueryParams) => apiClient.get<AuditPage>('/audit', { params }).then((r) => r.data),
  purge: (cutoffDate: string) => apiClient.post<PurgeResult>('/audit/purge', { cutoffDate }).then((r) => r.data),
};
