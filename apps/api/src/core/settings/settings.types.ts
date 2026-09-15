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

export const PASSWORD_POLICY_KEY = 'auth.password_policy';
export const TOKEN_LIFETIMES_KEY = 'auth.token_lifetimes';
