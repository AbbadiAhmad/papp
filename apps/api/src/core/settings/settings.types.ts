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

/**
 * system_settings key: "security.public_endpoint_rate_limit" (D34, §7.5).
 * Per-IP limit for @Public() WRITE endpoints — read PER REQUEST by
 * PublicThrottlerGuard (cheap: SettingsService caches), so an admin tuning
 * it takes effect immediately. Seeded by 0007_module_system.sql.
 */
export interface PublicEndpointRateLimit {
  /** Max requests per IP within the window. */
  limit: number;
  windowSeconds: number;
}

export const PASSWORD_POLICY_KEY = 'auth.password_policy';
export const TOKEN_LIFETIMES_KEY = 'auth.token_lifetimes';
export const NOTIFICATION_CATEGORIES_KEY = 'notifications.categories';
/**
 * system_settings key: "users.allow_self_registration" (D41) — plain JSONB
 * boolean. Default false (seeded by 0007): POST /auth/register 403s until an
 * admin opts in via PUT /settings/registration.
 */
export const ALLOW_SELF_REGISTRATION_KEY = 'users.allow_self_registration';
/**
 * system_settings key: "users.self_registration_role_code" — plain JSONB
 * string, or `null` when not yet configured (seeded by 0013). The role code
 * a self-registered account is assigned. papp is a general back-office
 * platform (CLAUDE.md), not Library-specific, so this can never be a
 * hardcoded role like "reader" — every deployment's role set beyond the
 * four seeded base roles is operator-defined. `null` means
 * `POST /auth/register` rejects until an admin picks a real role from
 * Settings -> Self-Registration.
 */
export const SELF_REGISTRATION_ROLE_CODE_KEY = 'users.self_registration_role_code';
export const PUBLIC_ENDPOINT_RATE_LIMIT_KEY = 'security.public_endpoint_rate_limit';
/** Prefix for every template key; full key = prefix + templateKey. */
export const NOTIFICATION_TEMPLATE_KEY_PREFIX = 'notifications.templates.';
export const PASSWORD_RESET_TEMPLATE_KEY = 'notifications.templates.password_reset';
export const FORCE_PASSWORD_CHANGE_TEMPLATE_KEY = 'notifications.templates.force_password_change';
