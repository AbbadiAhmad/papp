import { apiClient } from './httpClient';
import type { InboxResponse, NotificationTargetType } from './types';

export interface SendNotificationInput {
  category: string;
  title: string;
  bodyMarkdown: string;
  targetType: NotificationTargetType;
  targetId?: string;
  /** role targets: several roles at once (union of holders). */
  targetIds?: string[];
  /** Extra platform users added to the target's recipients. */
  extraUserIds?: string[];
  /** External addresses (no account): emailed only; not combinable with confirmation. */
  extraEmails?: string[];
  /** Ask each recipient to confirm through a personal emailed link (evidence is stored). */
  requiresConfirmation?: boolean;
  confirmationType?: string;
  confirmationAllowComment?: boolean;
}

export interface ConfirmationPreview {
  title: string;
  bodyHtml: string;
  confirmationType: string;
  allowComment: boolean;
  recipientName: string;
  confirmedAt: string | null;
  expired: boolean;
}

export interface ConfirmationRequestRow {
  id: string;
  title: string;
  category: string;
  confirmationType: string | null;
  createdAt: string;
  recipientCount: number;
  confirmedCount: number;
}

export interface ConfirmationEvidence {
  id: string;
  userId: string;
  confirmationType: string;
  confirmedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  confirmerName: string;
  confirmerEmail: string;
  comment: string | null;
  contentSha256: string;
  notificationTitle: string;
  notificationBodyMarkdown: string;
}

export interface ConfirmationDetail {
  notification: { id: string; title: string; createdAt: string; requiresConfirmation: boolean; confirmationType: string | null };
  confirmations: ConfirmationEvidence[];
  pending: Array<{ id: string; name: string; email: string }>;
}

export const notificationsApi = {
  send: (dto: SendNotificationInput) =>
    apiClient
      .post<{ id: string; recipientCount: number; emailedCount: number; externalEmails: string[] }>('/notifications', dto)
      .then((r) => r.data),
  getInbox: () => apiClient.get<InboxResponse>('/notifications/me').then((r) => r.data),
  listConfirmationRequests: () => apiClient.get<ConfirmationRequestRow[]>('/notifications/confirmations').then((r) => r.data),
  getConfirmations: (id: string) => apiClient.get<ConfirmationDetail>(`/notifications/${id}/confirmations`).then((r) => r.data),
  previewConfirmation: (token: string) =>
    apiClient.get<ConfirmationPreview>(`/notifications/confirm/${encodeURIComponent(token)}`).then((r) => r.data),
  confirm: (token: string, comment?: string) =>
    apiClient
      .post<{ confirmedAt: string; confirmationType: string }>(`/notifications/confirm/${encodeURIComponent(token)}`, { comment })
      .then((r) => r.data),
  markRead: (id: string) => apiClient.patch<{ notificationId: string; readAt: string }>(`/notifications/${id}/read`).then((r) => r.data),
};
