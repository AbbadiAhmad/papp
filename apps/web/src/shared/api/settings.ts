import { apiClient } from './httpClient';
import type { NotificationTemplate, PasswordPolicy, TokenLifetimes } from './types';

export const settingsApi = {
  getPasswordPolicy: () => apiClient.get<PasswordPolicy>('/settings/password-policy').then((r) => r.data),
  updatePasswordPolicy: (dto: PasswordPolicy) => apiClient.put<PasswordPolicy>('/settings/password-policy', dto).then((r) => r.data),

  getSessionTiming: () => apiClient.get<TokenLifetimes>('/settings/session-timing').then((r) => r.data),
  updateSessionTiming: (dto: TokenLifetimes) => apiClient.put<TokenLifetimes>('/settings/session-timing', dto).then((r) => r.data),

  getNotificationTemplates: () =>
    apiClient.get<Record<string, NotificationTemplate>>('/settings/notification-templates').then((r) => r.data),
  updateNotificationTemplates: (templates: Record<string, NotificationTemplate>) =>
    apiClient
      .put<Record<string, NotificationTemplate>>('/settings/notification-templates', { templates })
      .then((r) => r.data),

  getRegistration: () =>
    apiClient
      .get<{ allowSelfRegistration: boolean; selfRegistrationRoleCode: string | null }>('/settings/registration')
      .then((r) => r.data),
  /** `selfRegistrationRoleCode` omitted (vs. passed as `null`) leaves the current value unchanged server-side. */
  updateRegistration: (allowSelfRegistration: boolean, selfRegistrationRoleCode?: string) =>
    apiClient
      .put<{ allowSelfRegistration: boolean; selfRegistrationRoleCode: string | null }>('/settings/registration', {
        allowSelfRegistration,
        selfRegistrationRoleCode,
      })
      .then((r) => r.data),
};
