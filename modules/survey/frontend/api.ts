// See modules/library_catalog/frontend/api.ts's own docblock: this is a
// same-repo Vite import (bundled with the rest of apps/web), not the
// fragile cross-process import the backend half of this module needs.
import { API_BASE_URL, apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type SurveyStatus = 'draft' | 'published' | 'closed';

export const SURVEY_QUESTION_TYPES = [
  'short_text',
  'paragraph',
  'single_choice',
  'multi_choice',
  'dropdown',
  'linear_scale',
  'date',
  'time',
  'rating',
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const ENUMERATION_QUESTION_TYPES: readonly SurveyQuestionType[] = ['single_choice', 'multi_choice', 'dropdown'];

/** What the signed-in user may do with one survey: their role's permissions OR being a co-owner of it (SURVEY-D21). */
export interface SurveyAccessInfo {
  canEdit: boolean;
  canPublish: boolean;
  canViewResults: boolean;
  canExportResults: boolean;
  canManageOwners: boolean;
  isCoOwner: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  status: 'invited' | 'opened' | 'responded';
  invitedAt: string;
  openedAt: string | null;
  respondedAt: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
}

export interface AudienceInfo {
  restricted: boolean;
  allowedUsers: Array<{ userId: string; name: string; email: string }>;
  invitations: Invitation[];
}

export interface InviteResult {
  invited: number;
  alreadyInvited: number;
  invalid: string[];
  sent: number;
  failed: number;
}

export interface CoOwner {
  userId: string;
  name: string;
  email: string;
  addedAt?: string;
}

export interface SurveySummary {
  access?: SurveyAccessInfo;
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  archivedAt: string | null;
  requiresLogin: boolean;
  responseCount: number;
  opensAt: string | null;
  closesAt: string | null;
  responseLimit: number | null;
  /** For a published survey: open / not_open_yet / ended / full; null otherwise. */
  availability: 'open' | 'not_open_yet' | 'ended' | 'full' | null;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyQuestionOptionDto {
  id: string;
  orderIndex: number;
  value: string;
  label: string;
}

export interface SurveyQuestionDto {
  id: string;
  orderIndex: number;
  type: SurveyQuestionType;
  title: string;
  description?: string | null;
  required?: boolean;
  config?: Record<string, unknown>;
  options?: SurveyQuestionOptionDto[];
}

export interface SurveySectionDto {
  id: string;
  orderIndex: number;
  title: string;
  description?: string | null;
  navigation?: SectionNavigation;
  image?: SurveyImage | null;
  questions: SurveyQuestionDto[];
}

/** A picture on a survey, section or question. `alt` is required — it is what screen readers announce. */
export interface SurveyImage {
  mediaId: string;
  alt: string;
}

/** Where a picture is served from (public — respondents are often anonymous). */
export const mediaUrl = (mediaId: string): string => `${API_BASE_URL}/api/survey/media/${mediaId}`;

export interface SurveyLogicRuleDto {
  sourceQuestionId: string;
  sourceOptionValue: string;
  action: 'show' | 'hide';
  targetType: 'section' | 'question';
  targetId: string;
  orderIndex: number;
}

export interface SurveyDetail extends SurveySummary {
  ownerUserId: string;
  allowEditAfterSubmit: boolean;
  oneResponsePerRespondent: boolean;
  notifyOwnerOnSubmit: boolean;
  notifyEmails: string[];
  closedMessage: string | null;
  settings: { thankYouMessage?: string; showProgressBar?: boolean; headerImage?: SurveyImage; restricted?: boolean; emailCopy?: boolean };
  sections: SurveySectionDto[];
  logicRules: SurveyLogicRuleDto[];
}

export interface CreateSurveyInput {
  title: string;
  description?: string;
}

export interface UpdateSurveyInput {
  title?: string;
  description?: string;
  requiresLogin?: boolean;
  allowEditAfterSubmit?: boolean;
  oneResponsePerRespondent?: boolean;
  notifyOwnerOnSubmit?: boolean;
  notifyEmails?: string[];
  opensAt?: string | null;
  closesAt?: string | null;
  closedMessage?: string;
  responseLimit?: number | null;
  thankYouMessage?: string;
  showProgressBar?: boolean;
  headerImage?: SurveyImage | null;
  restricted?: boolean;
  emailCopy?: boolean;
}

export interface SurveyStructureInput {
  sections: SurveySectionDto[];
  logicRules?: SurveyLogicRuleDto[];
}

// --- respondent-facing shapes (see modules/survey/backend/responses.service.ts's toPublicSurvey) ---

export interface FillableQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  description: string | null;
  required: boolean;
  config: Record<string, unknown>;
  options: Array<{ value: string; label: string }>;
}

export interface SectionNavigationRoute {
  sourceQuestionId: string;
  sourceOptionValue: string;
  /** 'submit' or a later section's id. */
  target: string;
}

/** Where the respondent goes after a section. Empty/undefined = the next section. */
export interface SectionNavigation {
  defaultTarget?: string | null;
  routes?: SectionNavigationRoute[];
}

export interface FillableSurvey {
  id: string;
  title: string;
  description: string | null;
  allowEditAfterSubmit: boolean;
  requiresLogin: boolean;
  /** Text shown after submit (null = the default one). */
  thankYouMessage?: string | null;
  showProgressBar?: boolean;
  /** The response cap is reached: new submissions are refused, but people can still edit their own answer. */
  isFull?: boolean;
  /** The survey emails each respondent a copy of their answers. */
  emailCopy?: boolean;
  headerImage?: SurveyImage | null;
  closedMessage?: string | null;
  sections: Array<{ id: string; title: string; description: string | null; navigation: SectionNavigation; image?: SurveyImage | null; questions: FillableQuestion[] }>;
  logicRules: SurveyLogicRuleDto[];
}

export interface ExistingResponse {
  id: string;
  answers: Array<{ questionId: string; value: unknown }>;
}

export interface AnswerInput {
  questionId: string;
  value: unknown;
}

// --- admin response/report shapes ---

export interface ResponseListItem {
  id: string;
  respondentUserId: string | null;
  respondentEmail: string | null;
  submittedAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ResponseDetail extends ResponseListItem {
  surveyId: string;
  answers: Array<{ id: string; questionId: string; value: unknown }>;
}

export interface QuestionSummary {
  questionId: string;
  title: string;
  type: SurveyQuestionType;
  totalAnswered: number;
  optionCounts?: Array<{ value: string; label: string; count: number }>;
  /** Texts typed into an "Other" choice (capped). */
  otherAnswers?: string[];
  numeric?: { average: number; min: number; max: number; distribution: Array<{ value: number; count: number }> };
  sampleAnswers?: string[];
}

export interface SurveyReportSummary {
  surveyId: string;
  totalResponses: number;
  questions: QuestionSummary[];
}

export interface SurveyDataset {
  columns: Array<{ questionId: string; title: string; type: SurveyQuestionType }>;
  rows: Array<{ responseId: string; submittedAt: string; respondentLabel: string; answers: Record<string, unknown> }>;
}

export const surveyApi = {
  // --- admin: survey definition ---
  list: (archived = false) =>
    apiClient.get<SurveySummary[]>('/api/survey/surveys', { params: archived ? { archived: true } : undefined }).then((r) => r.data),
  archive: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/archive`).then((r) => r.data),
  unarchive: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/unarchive`).then((r) => r.data),
  duplicate: (id: string, title?: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/duplicate`, { title }).then((r) => r.data),
  exportPackage: (id: string, withResponses: boolean) =>
    apiClient
      .get<Blob>(`/api/survey/surveys/${id}/${withResponses ? 'export-with-responses' : 'export'}`, { responseType: 'blob' })
      .then((r) => r.data),
  importPackage: (file: File, includeResponses: boolean) => {
    const form = new FormData();
    form.append('includeResponses', String(includeResponses));
    form.append('file', file);
    return apiClient.post<SurveyDetail>('/api/survey/surveys/import', form).then((r) => r.data);
  },
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<{ mediaId: string }>(`/api/survey/surveys/${id}/media`, form).then((r) => r.data);
  },
  getAudience: (id: string) => apiClient.get<AudienceInfo>(`/api/survey/surveys/${id}/audience`).then((r) => r.data),
  addAllowedUser: (id: string, email: string) => apiClient.post<{ userId: string }>(`/api/survey/surveys/${id}/audience/users`, { email }).then((r) => r.data),
  removeAllowedUser: (id: string, userId: string) => apiClient.delete<{ userId: string }>(`/api/survey/surveys/${id}/audience/users/${userId}`).then((r) => r.data),
  invite: (id: string, emails: string[]) => apiClient.post<InviteResult>(`/api/survey/surveys/${id}/invitations`, { emails }).then((r) => r.data),
  remind: (id: string) => apiClient.post<{ reminded: number; failed: number; skipped: number }>(`/api/survey/surveys/${id}/invitations/remind`).then((r) => r.data),
  removeInvitation: (id: string, invitationId: string) => apiClient.delete<{ invitationId: string }>(`/api/survey/surveys/${id}/invitations/${invitationId}`).then((r) => r.data),
  listCoOwners: (id: string) => apiClient.get<{ owner: CoOwner; coOwners: CoOwner[] }>(`/api/survey/surveys/${id}/collaborators`).then((r) => r.data),
  addCoOwner: (id: string, email: string) =>
    apiClient.post<{ owner: CoOwner; coOwners: CoOwner[] }>(`/api/survey/surveys/${id}/collaborators`, { email }).then((r) => r.data),
  removeCoOwner: (id: string, userId: string) =>
    apiClient.delete<{ owner: CoOwner; coOwners: CoOwner[] }>(`/api/survey/surveys/${id}/collaborators/${userId}`).then((r) => r.data),
  get: (id: string) => apiClient.get<SurveyDetail>(`/api/survey/surveys/${id}`).then((r) => r.data),
  create: (dto: CreateSurveyInput) => apiClient.post<SurveyDetail>('/api/survey/surveys', dto).then((r) => r.data),
  update: (id: string, dto: UpdateSurveyInput) => apiClient.patch<SurveyDetail>(`/api/survey/surveys/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete<void>(`/api/survey/surveys/${id}`).then((r) => r.data),
  publish: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/publish`).then((r) => r.data),
  close: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/close`).then((r) => r.data),
  reopen: (id: string) => apiClient.post<SurveyDetail>(`/api/survey/surveys/${id}/reopen`).then((r) => r.data),
  replaceStructure: (id: string, dto: SurveyStructureInput) =>
    apiClient.put<SurveyDetail>(`/api/survey/surveys/${id}/structure`, dto).then((r) => r.data),

  // --- admin: responses/reports ---
  listResponses: (surveyId: string) => apiClient.get<ResponseListItem[]>(`/api/survey/surveys/${surveyId}/responses`).then((r) => r.data),
  getResponse: (surveyId: string, responseId: string) =>
    apiClient.get<ResponseDetail>(`/api/survey/surveys/${surveyId}/responses/${responseId}`).then((r) => r.data),
  removeResponse: (surveyId: string, responseId: string) =>
    apiClient.delete<void>(`/api/survey/surveys/${surveyId}/responses/${responseId}`).then((r) => r.data),
  exportResponses: (surveyId: string) =>
    apiClient.get<Blob>(`/api/survey/surveys/${surveyId}/responses/export`, { responseType: 'blob' }).then((r) => r.data),
  getSummary: (surveyId: string) => apiClient.get<SurveyReportSummary>(`/api/survey/surveys/${surveyId}/report/summary`).then((r) => r.data),
  getDataset: (surveyId: string) => apiClient.get<SurveyDataset>(`/api/survey/surveys/${surveyId}/report/dataset`).then((r) => r.data),

  // --- respondent: authenticated (any logged-in user, regardless of requiresLogin) ---
  getForFilling: (surveyId: string, invite?: string | null) =>
    apiClient.get<{ survey: FillableSurvey; existingResponse: ExistingResponse | null }>(`/api/survey/${surveyId}/fill`, { params: invite ? { invite } : undefined }).then((r) => r.data),
  submitAuthenticated: (surveyId: string, answers: AnswerInput[], invite?: string | null) =>
    apiClient.post<{ id: string }>(`/api/survey/${surveyId}/fill`, { answers }, { params: invite ? { invite } : undefined }).then((r) => r.data),

  // --- respondent: public/anonymous ---
  getForFillingPublic: (surveyId: string, invite?: string | null) =>
    apiClient.get<{ survey: FillableSurvey; existingResponse: ExistingResponse | null }>(`/api/survey/public/${surveyId}`, { params: invite ? { invite } : undefined }).then((r) => r.data),
  submitPublic: (surveyId: string, answers: AnswerInput[], opts: { invite?: string | null; copyToEmail?: string } = {}) =>
    apiClient
      .post<{ responseId: string; editToken: string | null }>(
        `/api/survey/public/${surveyId}`,
        { answers, ...(opts.copyToEmail ? { copyToEmail: opts.copyToEmail } : {}) },
        { params: opts.invite ? { invite: opts.invite } : undefined },
      )
      .then((r) => r.data),
  editPublic: (surveyId: string, editToken: string, answers: AnswerInput[]) =>
    apiClient.patch<{ id: string }>(`/api/survey/public/${surveyId}`, { answers }, { params: { editToken } }).then((r) => r.data),
};

/** Mirrors library_catalog/frontend/api.ts's own download helper. */
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
