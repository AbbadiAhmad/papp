/**
 * A static mirror of the core permission catalog seeded by
 * apps/api/src/core/migrations/0004_create_roles_permissions.sql. This is
 * NOT a grant list (it says nothing about who has what) — it is only the
 * fixed set of permission CODES core ships, needed as column labels in
 * PermissionsMatrixPage's degraded fallback mode when `GET /permissions`
 * itself is unreachable (see that page's docblock for why). It is exactly
 * as static as the locale files' `core.perm.*` keys already are (both are
 * hand-kept in sync with the same migration), so keeping it here duplicates
 * no more than i18n already requires.
 */
export interface CorePermissionCatalogEntry {
  code: string;
  category: string;
  descriptionI18nKey: string;
}

export const CORE_PERMISSION_CATALOG: CorePermissionCatalogEntry[] = [
  { code: 'users.view', category: 'users', descriptionI18nKey: 'core.perm.users.view' },
  { code: 'users.create', category: 'users', descriptionI18nKey: 'core.perm.users.create' },
  { code: 'users.update', category: 'users', descriptionI18nKey: 'core.perm.users.update' },
  { code: 'users.delete', category: 'users', descriptionI18nKey: 'core.perm.users.delete' },
  { code: 'users.import', category: 'users', descriptionI18nKey: 'core.perm.users.import' },
  { code: 'users.export', category: 'users', descriptionI18nKey: 'core.perm.users.export' },
  { code: 'users.settings.view', category: 'users_settings', descriptionI18nKey: 'core.perm.users.settings.view' },
  { code: 'users.settings.update', category: 'users_settings', descriptionI18nKey: 'core.perm.users.settings.update' },
  { code: 'roles.view', category: 'roles', descriptionI18nKey: 'core.perm.roles.view' },
  { code: 'roles.create', category: 'roles', descriptionI18nKey: 'core.perm.roles.create' },
  { code: 'roles.update', category: 'roles', descriptionI18nKey: 'core.perm.roles.update' },
  { code: 'roles.delete', category: 'roles', descriptionI18nKey: 'core.perm.roles.delete' },
  { code: 'roles.assign', category: 'roles', descriptionI18nKey: 'core.perm.roles.assign' },
  { code: 'permissions.view', category: 'permissions', descriptionI18nKey: 'core.perm.permissions.view' },
  { code: 'permissions.grant', category: 'permissions', descriptionI18nKey: 'core.perm.permissions.grant' },
  { code: 'sessions.view', category: 'sessions', descriptionI18nKey: 'core.perm.sessions.view' },
  { code: 'sessions.revoke', category: 'sessions', descriptionI18nKey: 'core.perm.sessions.revoke' },
];
