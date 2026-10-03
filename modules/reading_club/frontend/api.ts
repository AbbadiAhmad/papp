// Same-repo Vite import — see modules/template/frontend/api.ts's own docblock.
import { apiClient, isNotFoundError } from '../../../apps/web/src/shared/api/httpClient';

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

/**
 * `groupId`/`currentStageId` are nullable — a librarian can now delete the
 * group/stage a reader is actively assigned to (READING_CLUB-D16), which
 * sets these to null (`ON DELETE SET NULL`). `groupName`/`stageName` are
 * this membership's own snapshot, taken fresh on every assign/moveStage
 * call — always read THESE for display, never re-derive from groupId/
 * currentStageId, since they keep showing the right name even once the
 * live row is gone.
 */
export interface ReadingClubMembership {
  id: string;
  studentId: string;
  groupId: string | null;
  groupName: string | null;
  currentStageId: string | null;
  stageName: string | null;
  stageStartedAt: string;
  manualProgressAmount: number;
  assignedBy: string;
  assignedAt: string;
  updatedAt: string;
}

/** `groupId`/`stageId` are nullable — the group/stage this completion happened in may since have been deleted (READING_CLUB-D16). `groupName`/`stageName`/`stageOrder` are this row's own permanent snapshot — always read these for display, never groupId/stageId. */
export interface ReadingClubStageCompletion {
  id: string;
  studentId: string;
  episodeId: string;
  groupId: string | null;
  groupName: string | null;
  stageId: string | null;
  stageName: string | null;
  stageOrder: number | null;
  targetAmountAtCompletion: number;
  progressAmountAtCompletion: number;
  completedAt: string;
  markedBy: string;
  rewardStatus: RewardStatus;
  rewardDeliveredAt: string | null;
  rewardDeliveredBy: string | null;
  createdAt: string;
}

/** A reader's own completion history row — same shape as `ReadingClubStageCompletion` now that groupName/stageName/stageOrder live on the base type itself (READING_CLUB-D16); kept as a distinct alias since call sites already reference it by this name. */
export type ReaderCompletionRow = ReadingClubStageCompletion;

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

/** `groupId`/`stageId` are nullable — same READING_CLUB-D16 reasoning as `ReadingClubStageCompletion`; `groupName`/`stageName` are this entry's own snapshot, always read for display. */
export interface ReadingClubStageBookEntry {
  id: string;
  studentId: string;
  episodeId: string;
  groupId: string | null;
  groupName: string | null;
  stageId: string | null;
  stageName: string | null;
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
  /**
   * Same lookup as `getCurrentEpisode` but resolves to `null` (instead of
   * rejecting) when there is no current episode — a normal state after an
   * episode is deleted and before a new one is started (READING_CLUB-D17).
   * Pages that only need to know "is the episode I'm viewing the current
   * one" should use this, not `getCurrentEpisode`, so a missing current
   * episode never turns the whole page into an error state.
   */
  getCurrentEpisodeOrNull: () =>
    apiClient
      .get<ReadingClubEpisode>(`${BASE}/episodes/current`)
      .then((r) => r.data)
      .catch((err) => {
        if (isNotFoundError(err)) return null;
        throw err;
      }),
  createEpisode: (dto: CreateEpisodeInput) => apiClient.post<ReadingClubEpisode>(`${BASE}/episodes`, dto).then((r) => r.data),
  /** Real cascade blast-radius counts, fetched before the type-to-confirm delete dialog is shown (READING_CLUB-D17). */
  getEpisodeDeletePreview: (id: string) =>
    apiClient
      .get<{ episodeId: string; isCurrent: boolean; groupCount: number; readerCount: number; completionCount: number; bookEntryCount: number }>(
        `${BASE}/episodes/${id}/delete-preview`,
      )
      .then((r) => r.data),
  /** Full cascade delete — any episode, including the current one (READING_CLUB-D17). No history preservation, unlike group/stage delete. */
  removeEpisode: (id: string) =>
    apiClient
      .delete<{ affectedGroupCount: number; affectedReaderCount: number; affectedCompletionCount: number; affectedBookEntryCount: number; wasCurrent: boolean }>(
        `${BASE}/episodes/${id}`,
      )
      .then((r) => r.data),

  // Groups
  listGroups: (episodeId?: string) =>
    apiClient.get<ReadingClubGroup[]>(`${BASE}/groups`, { params: episodeId ? { episodeId } : undefined }).then((r) => r.data),
  getGroup: (id: string) => apiClient.get<ReadingClubGroup>(`${BASE}/groups/${id}`).then((r) => r.data),
  createGroup: (dto: CreateGroupInput) => apiClient.post<ReadingClubGroup>(`${BASE}/groups`, dto).then((r) => r.data),
  updateGroup: (id: string, dto: UpdateGroupInput) => apiClient.patch<ReadingClubGroup>(`${BASE}/groups/${id}`, dto).then((r) => r.data),
  /** Deletion is always allowed now, even with history against this group (READING_CLUB-D16) — the response reports how many readers were actively assigned at delete time, purely informational (the frontend's type-to-confirm dialog already warned beforehand). */
  removeGroup: (id: string) => apiClient.delete<{ affectedActiveReaderCount: number }>(`${BASE}/groups/${id}`).then((r) => r.data),

  // Stages
  createStage: (groupId: string, dto: CreateStageInput) =>
    apiClient.post<ReadingClubStage>(`${BASE}/groups/${groupId}/stages`, dto).then((r) => r.data),
  updateStage: (stageId: string, dto: UpdateStageInput) =>
    apiClient.patch<ReadingClubStage>(`${BASE}/groups/stages/${stageId}`, dto).then((r) => r.data),
  /** Deletion is always allowed now, even with history against this stage (READING_CLUB-D16) — see `removeGroup` above. */
  removeStage: (stageId: string) => apiClient.delete<{ affectedActiveReaderCount: number }>(`${BASE}/groups/stages/${stageId}`).then((r) => r.data),

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
