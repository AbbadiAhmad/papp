// Same-repo Vite import — see modules/template/frontend/api.ts's own docblock.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type StageTargetType = 'books' | 'pages';
export type RewardStatus = 'pending' | 'delivered';

export interface ReadingClubStage {
  id: string;
  groupId: string;
  stageOrder: number;
  name: string;
  targetType: StageTargetType;
  targetAmount: number;
  rewardDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingClubGroup {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  stages: ReadingClubStage[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  isActive?: boolean;
}

export type UpdateGroupInput = Partial<CreateGroupInput>;

export interface CreateStageInput {
  stageOrder: number;
  name: string;
  targetType: StageTargetType;
  targetAmount: number;
  rewardDescription?: string;
}

export type UpdateStageInput = Partial<CreateStageInput>;

export interface StageProgress {
  targetType: StageTargetType;
  targetAmount: number;
  progressAmount: number;
  isComplete: boolean;
}

export interface ReaderListItem {
  studentId: string;
  studentCode: string | null;
  studentName: string | null;
  groupId: string;
  groupName: string | null;
  currentStageId: string | null;
  stageName: string | null;
  stageOrder: number | null;
  progress: StageProgress | null;
}

export interface ReadingClubMembership {
  id: string;
  studentId: string;
  groupId: string;
  currentStageId: string | null;
  stageStartedAt: string;
  manualProgressAmount: number;
  assignedBy: string;
  assignedAt: string;
  updatedAt: string;
}

export interface ReadingClubStageCompletion {
  id: string;
  studentId: string;
  episodeId: string;
  groupId: string;
  stageId: string;
  targetAmountAtCompletion: number;
  progressAmountAtCompletion: number;
  completedAt: string;
  markedBy: string;
  rewardStatus: RewardStatus;
  rewardDeliveredAt: string | null;
  rewardDeliveredBy: string | null;
  createdAt: string;
}

/** A reader's own completion history row — extends the base completion with its (possibly PRIOR) group/stage identity, since a reader can have completions from a group they've since moved out of (READING_CLUB-D7). */
export interface ReaderCompletionRow extends ReadingClubStageCompletion {
  groupName: string | null;
  stageName: string | null;
  stageOrder: number | null;
}

export interface ReadingClubEpisode {
  id: string;
  name: string;
  isCurrent: boolean;
  startsAt: string;
  endsAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateEpisodeInput {
  name: string;
}

export type BookEntrySource = 'auto' | 'manual';
export type BookEntryStatus = 'active' | 'discarded';

export interface ReadingClubStageBookEntry {
  id: string;
  studentId: string;
  episodeId: string;
  groupId: string;
  stageId: string;
  borrowingId: string | null;
  bookCopyId: string | null;
  bookTitle: string;
  bookCode: string | null;
  source: BookEntrySource;
  comments: string | null;
  addedBy: string;
  addedAt: string;
  status: BookEntryStatus;
  discardedAt: string | null;
  discardedBy: string | null;
  discardReason: string | null;
}

export interface AddBookEntryInput {
  bookTitle: string;
  bookCode?: string;
  comments?: string;
  bookCopyId?: string;
}

export interface ReaderDetail {
  studentId: string;
  studentCode: string;
  studentName: string | null;
  className: string | null;
  membership: ReadingClubMembership | null;
  group: ReadingClubGroup | null;
  stage: ReadingClubStage | null;
  progress: StageProgress | null;
  completions: ReaderCompletionRow[];
}

export interface PendingReward {
  id: string;
  groupName: string | null;
  stageName: string | null;
  rewardDescription: string | null;
  completedAt: string;
}

/** The dashboard's cross-reader pending-rewards list (item C) — same shape as PendingReward plus the reader's own identity. */
export interface PendingRewardWithReader extends PendingReward {
  studentId: string;
  studentCode: string | null;
  studentName: string | null;
}

export interface DashboardStageStats {
  id: string;
  name: string;
  stageOrder: number;
  targetType: StageTargetType;
  targetAmount: number;
  readersOnStageCount: number;
}

export interface DashboardGroupStats {
  id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  stages: DashboardStageStats[];
}

export interface DashboardStats {
  totalGroups: number;
  totalActiveReaders: number;
  pendingRewardsCount: number;
  pendingRewards: PendingRewardWithReader[];
  groups: DashboardGroupStats[];
}

const BASE = '/api/reading-club';

export const readingClubApi = {
  // Episodes
  listEpisodes: () => apiClient.get<ReadingClubEpisode[]>(`${BASE}/episodes`).then((r) => r.data),
  getCurrentEpisode: () => apiClient.get<ReadingClubEpisode>(`${BASE}/episodes/current`).then((r) => r.data),
  createEpisode: (dto: CreateEpisodeInput) => apiClient.post<ReadingClubEpisode>(`${BASE}/episodes`, dto).then((r) => r.data),

  // Groups
  listGroups: (episodeId?: string) =>
    apiClient.get<ReadingClubGroup[]>(`${BASE}/groups`, { params: episodeId ? { episodeId } : undefined }).then((r) => r.data),
  getGroup: (id: string) => apiClient.get<ReadingClubGroup>(`${BASE}/groups/${id}`).then((r) => r.data),
  createGroup: (dto: CreateGroupInput) => apiClient.post<ReadingClubGroup>(`${BASE}/groups`, dto).then((r) => r.data),
  updateGroup: (id: string, dto: UpdateGroupInput) => apiClient.patch<ReadingClubGroup>(`${BASE}/groups/${id}`, dto).then((r) => r.data),
  removeGroup: (id: string) => apiClient.delete<void>(`${BASE}/groups/${id}`).then((r) => r.data),

  // Stages
  createStage: (groupId: string, dto: CreateStageInput) =>
    apiClient.post<ReadingClubStage>(`${BASE}/groups/${groupId}/stages`, dto).then((r) => r.data),
  updateStage: (stageId: string, dto: UpdateStageInput) =>
    apiClient.patch<ReadingClubStage>(`${BASE}/groups/stages/${stageId}`, dto).then((r) => r.data),
  removeStage: (stageId: string) => apiClient.delete<void>(`${BASE}/groups/stages/${stageId}`).then((r) => r.data),

  // Readers / memberships
  listReaders: (filter: { episodeId?: string; groupId?: string; stageId?: string; search?: string } = {}) => {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== ''));
    return apiClient.get<ReaderListItem[]>(`${BASE}/readers`, { params }).then((r) => r.data);
  },
  getReader: (studentId: string) => apiClient.get<ReaderDetail>(`${BASE}/readers/${studentId}`).then((r) => r.data),
  assign: (studentId: string, groupId: string, stageId?: string) =>
    apiClient.post<ReadingClubMembership>(`${BASE}/readers/assign`, { studentId, groupId, stageId }).then((r) => r.data),
  moveStage: (studentId: string, stageId: string) =>
    apiClient.post<ReadingClubMembership>(`${BASE}/readers/${studentId}/move-stage`, { stageId }).then((r) => r.data),
  updateProgress: (studentId: string, manualProgressAmount: number) =>
    apiClient.put<ReadingClubMembership>(`${BASE}/readers/${studentId}/progress`, { manualProgressAmount }).then((r) => r.data),

  // Stage completions / rewards
  completeStage: (studentId: string) =>
    apiClient.post<ReadingClubStageCompletion>(`${BASE}/readers/${studentId}/complete-stage`).then((r) => r.data),
  getPendingRewards: (studentId: string) => apiClient.get<PendingReward[]>(`${BASE}/readers/${studentId}/pending-rewards`).then((r) => r.data),
  confirmReward: (completionId: string) =>
    apiClient.post<ReadingClubStageCompletion>(`${BASE}/stage-completions/${completionId}/confirm-reward`).then((r) => r.data),

  // Stage book entries (per-stage "books read this stage" tracking)
  listBookEntries: (studentId: string) =>
    apiClient.get<ReadingClubStageBookEntry[]>(`${BASE}/readers/${studentId}/book-entries`).then((r) => r.data),
  addBookEntry: (studentId: string, dto: AddBookEntryInput) =>
    apiClient.post<ReadingClubStageBookEntry>(`${BASE}/readers/${studentId}/book-entries`, dto).then((r) => r.data),
  discardBookEntry: (studentId: string, entryId: string, reason?: string) =>
    apiClient
      .patch<ReadingClubStageBookEntry>(`${BASE}/readers/${studentId}/book-entries/${entryId}/discard`, { reason })
      .then((r) => r.data),
  removeBookEntry: (studentId: string, entryId: string) =>
    apiClient.delete<void>(`${BASE}/readers/${studentId}/book-entries/${entryId}`).then((r) => r.data),

  // Dashboard
  getDashboardStats: (episodeId?: string) =>
    apiClient.get<DashboardStats>(`${BASE}/dashboard`, { params: episodeId ? { episodeId } : undefined }).then((r) => r.data),
};
