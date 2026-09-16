import { z } from 'zod';

/**
 * The module manifest schema — the single source of truth for what a
 * `modules/<key>/manifest.json` may contain, matching docs/MODULE_SPEC.md §2
 * exactly (including the §8 `settings` array and the §7 public-route access
 * level). Shared between apps/api (install-time validation in
 * ModuleRegistryService) and apps/web (Phase 6's Modules admin screen), per
 * docs/BUILD_PLAN.md Phase 5.
 *
 * Zod (not class-validator) on purpose: this package is consumed by both the
 * frontend and backend, and Zod needs no decorator/reflect-metadata setup —
 * the schema doubles as the TypeScript type via z.infer.
 *
 * Field-level cross-checks that need DB or platform state (compatibleAppVersion
 * vs the running platform version, dependsOn installed, basePath/apiPrefix
 * collisions) live in ModuleRegistryService — this schema covers everything
 * checkable from the manifest text alone, including the *self*-consistency
 * rules: keys prefixed with the module key, menu parentIds resolving without
 * cycles, settings' requiredPermission declared in `permissions`, and every
 * menu/route path falling under `frontend.basePath` (§2's basePath note).
 */

/** snake_case module key — unique, immutable, used as DB/i18n/permission prefix. */
const moduleKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, 'module key must be snake_case: lowercase letters, digits, underscores');

/** Plain X.Y.Z semver (no range) — ranges are only valid in compatibleAppVersion. */
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a plain semver version (X.Y.Z)');

const permissionEntrySchema = z.object({
  /** e.g. "library_catalog.books.view" — must be prefixed "<moduleKey>." (checked below). */
  code: z.string().min(1),
  category: z.string().min(1),
  descriptionKey: z.string().min(1),
});

const settingEntrySchema = z.object({
  /** Full system_settings key — must be prefixed "<moduleKey>." (checked below, §8.1). */
  key: z.string().min(1),
  /** Informs the Settings UI's generic editor widget (§8.3). */
  type: z.enum(['json', 'string', 'number', 'boolean']),
  /** Seeded into system_settings on FIRST INSTALL ONLY (§8.1). */
  default: z.unknown(),
  /** i18n key for the Settings screen section heading. */
  labelKey: z.string().min(1),
  /** Must itself appear in this manifest's `permissions` array (§8.2, checked below). */
  requiredPermission: z.string().min(1),
});

const routeEntrySchema = z.object({
  pattern: z.string().min(1),
  /** §7: "public" routes are reachable with no login; default is authenticated. */
  access: z.enum(['public', 'authenticated']).default('authenticated'),
  /** RBAC is meaningless for anonymous visitors, so public routes carry none (§7.1). */
  requiredPermission: z.string().min(1).optional(),
  component: z.string().min(1),
});

const menuEntrySchema = z.object({
  id: z.string().min(1),
  labelKey: z.string().min(1),
  icon: z.string().min(1).optional(),
  /** null = top-level; otherwise another entry's id (must resolve, no cycles). */
  parentId: z.string().min(1).nullable(),
  order: z.number().int(),
  route: z.string().min(1),
  requiredPermission: z.string().min(1),
});

const baseManifestSchema = z.object({
  key: moduleKeySchema,
  name: z.string().min(1),
  version: semverSchema,
  /** Semver RANGE checked against the platform version at install time. */
  compatibleAppVersion: z.string().min(1),
  dependsOn: z.array(moduleKeySchema).default([]),
  description: z.string().default(''),

  migrations: z.object({
    dir: z.string().min(1).default('migrations'),
  }),

  locales: z.object({
    /** Must include the platform default language 'ar' (D19) — checked below. */
    supported: z.array(z.string().min(1)).min(1),
    dir: z.string().min(1).default('locales'),
  }),

  permissions: z.array(permissionEntrySchema).default([]),

  /** role code -> permission codes granted on FIRST INSTALL ONLY (§4/§5). */
  defaultRolePermissions: z.record(z.string(), z.array(z.string())).default({}),

  roleAccessPolicy: z.enum(['grantable', 'locked']).default('grantable'),
  /** role code -> true for roles that may NEVER be granted this module's permissions. */
  roleAccessLocked: z.record(z.string(), z.boolean()).default({}),

  settings: z.array(settingEntrySchema).default([]),

  routes: z.array(routeEntrySchema).default([]),

  menu: z.array(menuEntrySchema).default([]),

  frontend: z.object({
    basePath: z.string().min(1).regex(/^\//, 'basePath must start with "/"'),
    entry: z.string().min(1),
    landingPage: z.string().min(1),
  }),

  backend: z.object({
    entry: z.string().min(1),
    apiPrefix: z.string().min(1).regex(/^\//, 'apiPrefix must start with "/"'),
  }),

  lifecycle: z
    .object({
      onInstall: z.string().min(1).nullable().default(null),
      onUpgrade: z.string().min(1).nullable().default(null),
      onUninstall: z.string().min(1).nullable().default(null),
    })
    .default({ onInstall: null, onUpgrade: null, onUninstall: null }),
});

/** Is `path` equal to, or nested under, `basePath`? ("/library" owns "/library/books"). */
function isUnderBasePath(path: string, basePath: string): boolean {
  const normalized = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/**
 * The full manifest schema, including the self-consistency refinements
 * (MODULE_SPEC.md §2/§4 step 2 — everything checkable without DB state).
 */
export const moduleManifestSchema = baseManifestSchema.superRefine((manifest, ctx) => {
  const prefix = `${manifest.key}.`;

  // Permission codes must be namespaced under the module key (§2).
  manifest.permissions.forEach((perm, i) => {
    if (!perm.code.startsWith(prefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions', i, 'code'],
        message: `permission code "${perm.code}" must be prefixed with "${prefix}"`,
      });
    }
  });
  const declaredCodes = new Set(manifest.permissions.map((p) => p.code));

  // Settings keys must be namespaced, and their requiredPermission declared (§8).
  manifest.settings.forEach((setting, i) => {
    if (!setting.key.startsWith(prefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', i, 'key'],
        message: `setting key "${setting.key}" must be prefixed with "${prefix}"`,
      });
    }
    if (!declaredCodes.has(setting.requiredPermission)) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', i, 'requiredPermission'],
        message: `setting "${setting.key}" requires permission "${setting.requiredPermission}" which is not in this manifest's permissions array`,
      });
    }
  });

  // defaultRolePermissions may only grant codes this manifest declares (§2).
  for (const [role, codes] of Object.entries(manifest.defaultRolePermissions)) {
    codes.forEach((code, i) => {
      if (!declaredCodes.has(code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['defaultRolePermissions', role, i],
          message: `default grant "${code}" for role "${role}" is not in this manifest's permissions array`,
        });
      }
    });
  }

  // Menu: ids unique, parentIds resolve, no cycles, permissions declared,
  // routes under basePath (§4 step 5 / §2 basePath note).
  const menuIds = new Set<string>();
  manifest.menu.forEach((entry, i) => {
    if (menuIds.has(entry.id)) {
      ctx.addIssue({ code: 'custom', path: ['menu', i, 'id'], message: `duplicate menu id "${entry.id}"` });
    }
    menuIds.add(entry.id);
  });
  manifest.menu.forEach((entry, i) => {
    if (entry.parentId !== null && !menuIds.has(entry.parentId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['menu', i, 'parentId'],
        message: `menu entry "${entry.id}" has parentId "${entry.parentId}" which does not resolve to another entry`,
      });
    }
    if (!declaredCodes.has(entry.requiredPermission)) {
      ctx.addIssue({
        code: 'custom',
        path: ['menu', i, 'requiredPermission'],
        message: `menu entry "${entry.id}" requires undeclared permission "${entry.requiredPermission}"`,
      });
    }
    if (!isUnderBasePath(entry.route, manifest.frontend.basePath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['menu', i, 'route'],
        message: `menu route "${entry.route}" must fall under frontend.basePath "${manifest.frontend.basePath}"`,
      });
    }
  });
  // Cycle detection over parentId edges (a parentId pointing at a descendant).
  const parentOf = new Map(manifest.menu.map((entry) => [entry.id, entry.parentId]));
  manifest.menu.forEach((entry, i) => {
    const seen = new Set<string>([entry.id]);
    let current = entry.parentId;
    while (current !== null && current !== undefined) {
      if (seen.has(current)) {
        ctx.addIssue({
          code: 'custom',
          path: ['menu', i, 'parentId'],
          message: `menu entry "${entry.id}" is part of a parentId cycle`,
        });
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  });

  // Routes: public routes carry no requiredPermission (§7.1); authenticated
  // ones that name a permission must declare it; all under basePath.
  manifest.routes.forEach((route, i) => {
    if (route.access === 'public' && route.requiredPermission !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['routes', i, 'requiredPermission'],
        message: `public route "${route.pattern}" must not have a requiredPermission (RBAC does not apply to anonymous visitors, §7.1)`,
      });
    }
    if (route.requiredPermission !== undefined && !declaredCodes.has(route.requiredPermission)) {
      ctx.addIssue({
        code: 'custom',
        path: ['routes', i, 'requiredPermission'],
        message: `route "${route.pattern}" requires undeclared permission "${route.requiredPermission}"`,
      });
    }
    if (!isUnderBasePath(route.pattern, manifest.frontend.basePath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['routes', i, 'pattern'],
        message: `route pattern "${route.pattern}" must fall under frontend.basePath "${manifest.frontend.basePath}"`,
      });
    }
  });

  // landingPage must be one of the module's own paths.
  if (!isUnderBasePath(manifest.frontend.landingPage, manifest.frontend.basePath)) {
    ctx.addIssue({
      code: 'custom',
      path: ['frontend', 'landingPage'],
      message: `landingPage "${manifest.frontend.landingPage}" must fall under frontend.basePath "${manifest.frontend.basePath}"`,
    });
  }
});

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type ModuleManifestPermission = z.infer<typeof permissionEntrySchema>;
export type ModuleManifestSetting = z.infer<typeof settingEntrySchema>;
export type ModuleManifestRoute = z.infer<typeof routeEntrySchema>;
export type ModuleManifestMenuEntry = z.infer<typeof menuEntrySchema>;

/** module_registry.status values (MODULE_SPEC.md §3). */
export type ModuleStatus = 'installing' | 'installed' | 'upgrading' | 'disabled' | 'uninstalling' | 'failed';

export interface ManifestValidationIssue {
  path: string;
  message: string;
}

export type ManifestParseResult =
  | { success: true; manifest: ModuleManifest }
  | { success: false; issues: ManifestValidationIssue[] };

/**
 * Parses + validates raw manifest JSON. Never throws — returns a structured
 * issue list the Modules admin screen can display verbatim.
 */
export function parseModuleManifest(raw: unknown): ManifestParseResult {
  const result = moduleManifestSchema.safeParse(raw);
  if (result.success) {
    return { success: true, manifest: result.data };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
