/**
 * Mirrors of the backend's `Public*` presenter shapes (apps/api/src/core/**\/*.presenter.ts)
 * and other response DTOs. Dates arrive as ISO strings over JSON, never as
 * `Date` instances — typed as `string` here, formatted through
 * `shared/format.ts` (never a raw `toLocaleDateString()`).
 */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  externalId: string | null;
  department: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  defaultLandingPage: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/** `GET /users/me/landing-page-options` entry — `value: null` is the platform default. */
export interface LandingPageOption {
  value: string | null;
  labelKey: string;
  moduleKey: string | null;
}

export interface PublicRole {
  id: string;
  code: string;
  nameI18nKey: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPermission {
  id: string;
  code: string;
  moduleKey: string;
  category: string;
  descriptionI18nKey: string;
}

export interface PublicSession {
  id: string;
  userId: string;
  issuedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  geoLocation: unknown;
  revokedAt: string | null;
}

export type AuditActorType = 'user' | 'system' | 'anonymous';

export interface AuditLogItem {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorSessionId: string | null;
  actorType: AuditActorType;
  category: string;
  entityType: string;
  entityId: string | null;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditPage {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurgeResult {
  cutoffDate: string;
  rowsDeleted: number;
}

export interface AuditQueryParams {
  category?: string;
  entityType?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type ImportRowAction = 'create' | 'update';

export interface ParsedImportRow {
  row: number;
  name: string | null;
  email: string | null;
  externalId: string | null;
  roleCode: string | null;
  department: string | null;
}

export interface ImportRowResult extends ParsedImportRow {
  valid: boolean;
  error: string | null;
  action: ImportRowAction | null;
  matchedUserId: string | null;
}

export interface ImportReport {
  rows: ImportRowResult[];
  validCount: number;
  invalidCount: number;
  allValid: boolean;
}

export interface PasswordPolicy {
  minLength: number;
  requireLetter: boolean;
  requireNumber: boolean;
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export interface TokenLifetimes {
  accessTokenMinutes: number;
  refreshTokenDays: number;
  idleTimeoutMinutes: number;
  absoluteTimeoutDays: number;
}

export interface NotificationTemplate {
  subject: string;
  bodyMarkdown: string;
}

export type NotificationTargetType = 'user' | 'role' | 'all_users';

export interface InboxItem {
  notificationId: string;
  category: string;
  title: string;
  bodyMarkdown: string;
  bodyHtml: string;
  createdAt: string;
  readAt: string | null;
}

export interface InboxResponse {
  unreadCount: number;
  notifications: InboxItem[];
}

export type ModuleStatus = 'installing' | 'installed' | 'upgrading' | 'disabled' | 'uninstalling' | 'failed';

export interface PublicModuleEntry {
  key: string;
  version: string;
  status: ModuleStatus;
  installedAt: string | null;
  updatedAt: string;
  manifestSnapshot: unknown;
}

export interface ManifestValidationIssue {
  path: string;
  message: string;
}
