import { describe, expect, it } from '@jest/globals';
import { parseModuleManifest, type ManifestValidationIssue } from '@papp/shared-types';

/**
 * @papp/shared-types has no test runner of its own (it's a types-only
 * workspace package with no jest config) — per this phase's task
 * description it's exercised from here via the `@papp/shared-types`
 * moduleNameMapper alias in jest.base.config.ts, which points straight at
 * the package's `src/` (not its build output), so this suite always runs
 * against the current source, not a stale `dist/`.
 *
 * Covers moduleManifestSchema's SELF-consistency rules only (module-manifest.ts
 * §"self-consistency" refinements) — the DB/platform-state cross-checks
 * (compatibleAppVersion vs PLATFORM_VERSION, dependsOn installed,
 * basePath/apiPrefix collisions) are ModuleRegistryService's job and covered
 * in module-registry.service.spec.ts instead.
 */

/** A complete, self-consistent minimal manifest — every test starts here and mutates one thing. */
function validManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    key: 'library_catalog',
    name: 'Library Catalog',
    version: '1.0.0',
    compatibleAppVersion: '>=0.1.0',
    dependsOn: [],
    description: 'Books and catalog management',
    migrations: { dir: 'migrations' },
    locales: { supported: ['ar', 'en'], dir: 'locales' },
    permissions: [
      { code: 'library_catalog.books.view', category: 'books', descriptionKey: 'library_catalog.perm.books.view' },
    ],
    defaultRolePermissions: { admin: ['library_catalog.books.view'] },
    roleAccessPolicy: 'grantable',
    roleAccessLocked: {},
    settings: [
      {
        key: 'library_catalog.loan_period_days',
        type: 'number',
        default: 14,
        labelKey: 'library_catalog.settings.loan_period_days',
        requiredPermission: 'library_catalog.books.view',
      },
    ],
    routes: [
      {
        pattern: '/library_catalog/books',
        access: 'authenticated',
        requiredPermission: 'library_catalog.books.view',
        component: 'BooksPage',
      },
    ],
    menu: [
      {
        id: 'library_catalog_root',
        labelKey: 'library_catalog.menu.root',
        parentId: null,
        order: 1,
        route: '/library_catalog/books',
        requiredPermission: 'library_catalog.books.view',
      },
    ],
    frontend: { basePath: '/library_catalog', entry: 'index.tsx', landingPage: '/library_catalog/books' },
    backend: { entry: 'index.ts', apiPrefix: '/library_catalog' },
    lifecycle: { onInstall: null, onUpgrade: null, onUninstall: null },
    ...overrides,
  };
}

function issuePaths(issues: ManifestValidationIssue[]): string[] {
  return issues.map((issue) => issue.path);
}

describe('moduleManifestSchema / parseModuleManifest', () => {
  it('accepts a valid minimal manifest', () => {
    const result = parseModuleManifest(validManifest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.key).toBe('library_catalog');
      expect(result.manifest.frontend.basePath).toBe('/library_catalog');
    }
  });

  it('does NOT reject a missing "ar" in locales.supported at the schema layer (documents a boundary)', () => {
    // AMBIGUITY (see final report): docs/CLAUDE.md D19 and this schema
    // file's own doc-comment ("Must include the platform default language
    // 'ar' (D19) — checked below") both read as if `moduleManifestSchema`
    // itself enforces "ar" ∈ locales.supported. It does not — the
    // superRefine block below has no such check. The actual enforcement is
    // in ModuleRegistryService.validateAgainstPlatform (needs the platform's
    // DEFAULT_LANGUAGE constant, arguably DB/platform state at that point
    // only by convention, not by hard requirement) — see the "missing 'ar'
    // locale" case in module-registry.service.spec.ts. This test locks in
    // the schema's ACTUAL behavior — a non-empty `supported` array of any
    // languages parses fine — so a future fix to either the code or the
    // comment doesn't regress silently.
    const result = parseModuleManifest(validManifest({ locales: { supported: ['en'], dir: 'locales' } }));
    expect(result.success).toBe(true);
  });

  it('fails when locales.supported is empty (independent of the "ar" question above)', () => {
    const result = parseModuleManifest(validManifest({ locales: { supported: [], dir: 'locales' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('locales.supported');
    }
  });

  it('fails when a permission code is not prefixed with the module key', () => {
    const result = parseModuleManifest(
      validManifest({
        permissions: [{ code: 'wrong_module.books.view', category: 'books', descriptionKey: 'x' }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('permissions.0.code');
      expect(result.issues.find((i) => i.path === 'permissions.0.code')?.message).toMatch(
        /must be prefixed with "library_catalog\."/,
      );
    }
  });

  it('fails when a settings entry\'s requiredPermission is not declared in the manifest\'s own permissions[]', () => {
    const result = parseModuleManifest(
      validManifest({
        settings: [
          {
            key: 'library_catalog.loan_period_days',
            type: 'number',
            default: 14,
            labelKey: 'library_catalog.settings.loan_period_days',
            requiredPermission: 'library_catalog.books.undeclared',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('settings.0.requiredPermission');
    }
  });

  it('fails when a menu entry\'s parentId does not resolve to another entry', () => {
    const result = parseModuleManifest(
      validManifest({
        menu: [
          {
            id: 'library_catalog_root',
            labelKey: 'library_catalog.menu.root',
            parentId: 'nonexistent_entry',
            order: 1,
            route: '/library_catalog/books',
            requiredPermission: 'library_catalog.books.view',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('menu.0.parentId');
      expect(result.issues.find((i) => i.path === 'menu.0.parentId')?.message).toMatch(/does not resolve/);
    }
  });

  it('fails on a menu cycle (A -> B -> A)', () => {
    const result = parseModuleManifest(
      validManifest({
        menu: [
          {
            id: 'a',
            labelKey: 'library_catalog.menu.a',
            parentId: 'b',
            order: 1,
            route: '/library_catalog/a',
            requiredPermission: 'library_catalog.books.view',
          },
          {
            id: 'b',
            labelKey: 'library_catalog.menu.b',
            parentId: 'a',
            order: 2,
            route: '/library_catalog/b',
            requiredPermission: 'library_catalog.books.view',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => /parentId cycle/.test(i.message))).toBe(true);
    }
  });

  it('fails when a menu route is not nested under frontend.basePath', () => {
    const result = parseModuleManifest(
      validManifest({
        menu: [
          {
            id: 'library_catalog_root',
            labelKey: 'library_catalog.menu.root',
            parentId: null,
            order: 1,
            route: '/somewhere_else/books',
            requiredPermission: 'library_catalog.books.view',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('menu.0.route');
    }
  });

  it('fails when a route pattern is not nested under frontend.basePath', () => {
    const result = parseModuleManifest(
      validManifest({
        routes: [
          {
            pattern: '/somewhere_else/books',
            access: 'authenticated',
            requiredPermission: 'library_catalog.books.view',
            component: 'BooksPage',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('routes.0.pattern');
    }
  });

  it('fails on a bad (non plain X.Y.Z) semver in `version`, even though `compatibleAppVersion` accepts a range', () => {
    const result = parseModuleManifest(validManifest({ version: '1.0', compatibleAppVersion: '>=0.1.0 <2.0.0' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('version');
      // The range in compatibleAppVersion must NOT itself be rejected by this
      // rule — it's a free-form string at the schema layer (semver.satisfies
      // is checked later, against the platform version, in ModuleRegistryService).
      expect(issuePaths(result.issues)).not.toContain('compatibleAppVersion');
    }
  });

  it('accepts a valid semver range in compatibleAppVersion alongside a valid plain version', () => {
    const result = parseModuleManifest(validManifest({ compatibleAppVersion: '>=0.1.0 <2.0.0' }));
    expect(result.success).toBe(true);
  });

  it('fails when a public route declares a requiredPermission (RBAC does not apply to anonymous visitors)', () => {
    const result = parseModuleManifest(
      validManifest({
        routes: [
          {
            pattern: '/library_catalog/public-search',
            access: 'public',
            requiredPermission: 'library_catalog.books.view',
            component: 'PublicSearchPage',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('routes.0.requiredPermission');
    }
  });

  it('fails when defaultRolePermissions grants a code the manifest itself does not declare', () => {
    const result = parseModuleManifest(
      validManifest({ defaultRolePermissions: { admin: ['library_catalog.books.undeclared'] } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('defaultRolePermissions.admin.0');
    }
  });

  it('fails when a setting key is not prefixed with the module key', () => {
    const result = parseModuleManifest(
      validManifest({
        settings: [
          {
            key: 'wrong_module.loan_period_days',
            type: 'number',
            default: 14,
            labelKey: 'library_catalog.settings.loan_period_days',
            requiredPermission: 'library_catalog.books.view',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('settings.0.key');
    }
  });

  it('fails when frontend.landingPage falls outside frontend.basePath', () => {
    const result = parseModuleManifest(validManifest({ frontend: { basePath: '/library_catalog', entry: 'index.tsx', landingPage: '/somewhere_else' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result.issues)).toContain('frontend.landingPage');
    }
  });

  it('fails on a duplicate menu id', () => {
    const result = parseModuleManifest(
      validManifest({
        menu: [
          {
            id: 'dup',
            labelKey: 'library_catalog.menu.a',
            parentId: null,
            order: 1,
            route: '/library_catalog/a',
            requiredPermission: 'library_catalog.books.view',
          },
          {
            id: 'dup',
            labelKey: 'library_catalog.menu.b',
            parentId: null,
            order: 2,
            route: '/library_catalog/b',
            requiredPermission: 'library_catalog.books.view',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => /duplicate menu id/.test(i.message))).toBe(true);
    }
  });

  it('rejects a module key that is not snake_case', () => {
    const result = parseModuleManifest(validManifest({ key: 'LibraryCatalog' }));
    expect(result.success).toBe(false);
  });

  it('never throws — always returns a structured result even for garbage input', () => {
    expect(() => parseModuleManifest(null)).not.toThrow();
    expect(() => parseModuleManifest({})).not.toThrow();
    expect(() => parseModuleManifest('not an object')).not.toThrow();
    expect(parseModuleManifest({}).success).toBe(false);
  });
});
