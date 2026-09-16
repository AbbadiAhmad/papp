import { apiClient } from './httpClient';
import type { InboxResponse, NotificationTargetType } from './types';

export interface SendNotificationInput {
  category: string;
  title: string;
  bodyMarkdown: string;
  targetType: NotificationTargetType;
  targetId?: string;
}

export const notificationsApi = {
  send: (dto: SendNotificationInput) =>
    apiClient
      .post<{ id: string; recipientCount: number; emailedCount: number }>('/notifications', dto)
      .then((r) => r.data),
  getInbox: () => apiClient.get<InboxResponse>('/notifications/me').then((r) => r.data),
  markRead: (id: string) => apiClient.patch<{ notificationId: string; readAt: string }>(`/notifications/${id}/read`).then((r) => r.data),
};
