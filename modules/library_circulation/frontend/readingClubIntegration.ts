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

/** Subset of reading_club's `GET /readers/:studentId` this module renders on the Scan page. */
export interface ReadingClubReaderOverview {
  membership: { groupId: string | null; groupName: string | null; currentStageId: string | null; stageName: string | null } | null;
  group: { id: string; name: string } | null;
  stage: { id: string; stageOrder: number; name: string; rewardDescription: string | null } | null;
  progress: { targetType: 'books' | 'pages'; targetAmount: number; progressAmount: number; isComplete: boolean } | null;
  groupStages: { id: string; stageOrder: number; name: string; targetType: 'books' | 'pages'; targetAmount: number }[];
  completions: { id: string; stageName: string | null; stageOrder: number | null; completedAt: string; rewardStatus: 'pending' | 'delivered' }[];
}

export const readingClubIntegration = {
  getReaderOverview: (studentId: string) =>
    apiClient.get<ReadingClubReaderOverview>(`/api/reading-club/readers/${studentId}`).then((r) => r.data),
  completeStage: (studentId: string) => apiClient.post(`/api/reading-club/readers/${studentId}/complete-stage`).then((r) => r.data),
  getPendingRewards: (studentId: string) =>
    apiClient.get<ReadingClubPendingReward[]>(`/api/reading-club/readers/${studentId}/pending-rewards`).then((r) => r.data),
  confirmReward: (completionId: string) => apiClient.post(`/api/reading-club/stage-completions/${completionId}/confirm-reward`).then((r) => r.data),
};
