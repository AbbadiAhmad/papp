/**
 * Shapes of the two `system_settings` values Phase 1 depends on. Seeded by
 * apps/api/src/core/migrations/0003_create_system_settings.sql; read via
 * SettingsService.get<T>(key).
 */

/** system_settings key: "auth.password_policy" */
export interface PasswordPolicy {
  minLength: number;
  requireLetter: boolean;
  requireNumber: boolean;
  /** Failed attempts before the account is locked out. */
  maxFailedAttempts: number;
  /** Lockout duration once maxFailedAttempts is reached. */
  lockoutMinutes: number;
}

/** system_settings key: "auth.token_lifetimes" */
export interface TokenLifetimes {
  accessTokenMinutes: number;
  refreshTokenDays: number;
  /** A session is expired if idle (no activity) longer than this. */
  idleTimeoutMinutes: number;
  /** A session is expired once its age exceeds this, regardless of activity. */
  absoluteTimeoutDays: number;
}

/**
 * system_settings keys: "notifications.templates.<templateKey>" (D22, §12.3).
 * One freeform {subject, bodyMarkdown} pair per template — operator-authored
 * CONTENT in whatever language the admin chooses, NOT developer i18n keys.
 * The only placeholder the Phase 4 renderer substitutes is {{name}} (the
 * recipient's display name) — see NotificationsService.
 */
export interface NotificationTemplate {
  subject: string;
  bodyMarkdown: string;
}

/**
 * system_settings key: "notifications.categories" — which categories ALSO
 * go out via email (every send always fans out in-app rows regardless).
 * A category absent from this map defaults to in-app only.
 */
export type NotificationCategoriesConfig = Record<string, { email: boolean }>;

export const PASSWORD_POLICY_KEY = 'auth.password_policy';
export const TOKEN_LIFETIMES_KEY = 'auth.token_lifetimes';
export const NOTIFICATION_CATEGORIES_KEY = 'notifications.categories';
/** Prefix for every template key; full key = prefix + templateKey. */
export const NOTIFICATION_TEMPLATE_KEY_PREFIX = 'notifications.templates.';
export const PASSWORD_RESET_TEMPLATE_KEY = 'notifications.templates.password_reset';
export const FORCE_PASSWORD_CHANGE_TEMPLATE_KEY = 'notifications.templates.force_password_change';
