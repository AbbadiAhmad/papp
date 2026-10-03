// Deliberately a RAW `apiClient` call to reading_club's own endpoints, never
// a static `import` of that module's `frontend/api.ts` — library_circulation
// does NOT `dependsOn: ["reading_club"]` (it's the other way around), so a
// static cross-module import here would be architecturally backward and
// would break if reading_club's module directory were ever absent from a
// deployment. Every call below fails gracefully (caught by the caller) when
// reading_club isn't installed or the endpoint 403s — this integration is
// entirely optional/additive. See this module's own DECISIONS.md and
// modules/reading_club/DECISIONS.md for the full reasoning.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export interface ReadingClubPendingReward {
  id: string;
  groupName: string | null;
  stageName: string | null;
  rewardDescription: string | null;
  completedAt: string;
}

export const readingClubIntegration = {
  getPendingRewards: (studentId: string) =>
    apiClient.get<ReadingClubPendingReward[]>(`/api/reading-club/readers/${studentId}/pending-rewards`).then((r) => r.data),
  confirmReward: (completionId: string) => apiClient.post(`/api/reading-club/stage-completions/${completionId}/confirm-reward`).then((r) => r.data),
};
