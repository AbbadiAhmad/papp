import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleManifest, parseModuleManifest } from '@papp/shared-types';
import { Prisma } from '@prisma/client';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import * as semver from 'semver';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_LANGUAGE, I18nService } from '../i18n/i18n.service';
import { PLATFORM_VERSION } from '../../platform-version';
import { MigrationRunnerService } from './migration-runner.service';
import { FrontendModuleManifest, PublicModuleEntry, toFrontendModuleManifest, toPublicModuleEntry } from './module-registry.presenter';
import { resolveModulesDir } from './modules-dir';

/** Registry statuses that mean "an install is already live or in flight". */
const ACTIVE_STATUSES = new Set(['installed', 'installing', 'upgrading']);
/** Registry statuses a module may be upgraded FROM. */
const UPGRADABLE_STATUSES = new Set(['installed', 'disabled']);
/** Registry statuses a module may be uninstalled FROM. */
const UNINSTALLABLE_STATUSES = new Set(['installed', 'disabled', 'failed']);

/**
 * Core apiPrefix/basePath namespace core itself already occupies. Core's own
 * routes are plain NestJS controllers, not manifest-declared, so they can't
 * be cross-checked automatically the way module-vs-module collisions are
 * (MODULE_SPEC.md §4 step 2) — this fixed list is the defensive backstop so
 * a module can never register `/users` or `/auth` out from under core.
 * `frontend.basePath` reservations are best-effort (Phase 6 hasn't fixed the
 * SPA's final route names yet); `backend.apiPrefix` maps 1:1 to real,
 * already-live Nest controller prefixes, so that half is authoritative.
 */
const RESERVED_API_PREFIXES = [
  '/auth',
  '/users',
  '/sessions',
  '/roles',
  '/permissions',
  '/audit',
  '/settings',
  '/notifications',
  '/modules',
  '/i18n',
  '/health',
];
const RESERVED_BASE_PATHS = [
  '/login',
  '/users',
  '/roles',
  '/permissions',
  '/sessions',
  '/audit',
  '/notifications',
  '/settings',
  '/modules',
];

export interface ManifestValidationError {
  path: string;
  message: string;
}

/** Is `path` equal to, or nested under/over, `basePath` (either direction)? */
function pathsCollide(a: string, b: string): boolean {
  const na = a.endsWith('/') ? a.slice(0, -1) : a;
  const nb = b.endsWith('/') ? b.slice(0, -1) : b;
  return na === nb || na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

/**
 * Implements MODULE_SPEC.md §4/§5 install/upgrade/uninstall lifecycle for
 * real modules under `modules/<key>/` (or `MODULES_DIR`). Core's own
 * migrations/registry row are handled separately in main.ts (core is a
 * pseudo-module, not driven through this admin-facing flow).
 *
 * Validation ALWAYS runs to completion, and NO migration is ever run, before
 * anything is written beyond the registry row's own status/manifestSnapshot
 * fields (BUILD_PLAN.md risk #4's sibling risk: "validate everything BEFORE
 * running any migration"). `defaultRolePermissions`/`settings` seeding only
 * ever happens inside `install()` (grants) or inside both `install()` AND
 * `upgrade()` for settings (upsert-no-op-on-existing makes that identical to
 * "first install only, new keys on upgrade" without needing two code paths).
 */
@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationRunner: MigrationRunnerService,
    private readonly i18n: I18nService,
  ) {}

  async list(): Promise<PublicModuleEntry[]> {
    const rows = await this.prisma.moduleRegistryEntry.findMany({ orderBy: { key: 'asc' } });
    return rows.map(toPublicModuleEntry);
  }

  /**
   * The generic frontend-shell feed (root DECISIONS.md D78): every currently
   * INSTALLED module's routes/menu, and nothing else — this is what lets
   * `apps/web/src/App.tsx`/`PageLayout.tsx` mount a module's routes and
   * sidebar entries without importing that module by name. `core` is
   * excluded — its own routes/menu are the platform's, not a module's, and
   * stay hardcoded in the shell same as always.
   */
  async listFrontendManifests(): Promise<FrontendModuleManifest[]> {
    const rows = await this.prisma.moduleRegistryEntry.findMany({
      where: { status: 'installed', key: { not: 'core' } },
      orderBy: { key: 'asc' },
    });
    return rows.map(toFrontendModuleManifest).filter((m): m is FrontendModuleManifest => m !== null);
  }

  async install(key: string, installedBy?: string): Promise<PublicModuleEntry> {
    const manifestPath = this.manifestPathFor(key);
    if (!existsSync(manifestPath)) {
      throw new NotFoundException(`No manifest.json found for module "${key}" (looked at ${manifestPath})`);
    }

    const existing = await this.prisma.moduleRegistryEntry.findUnique({ where: { key } });
    if (existing && ACTIVE_STATUSES.has(existing.status)) {
      throw new ConflictException(
        `Module "${key}" is already "${existing.status}" — install is rejected (idempotent: re-install a ` +
          'genuinely new version with POST /modules/:key/upgrade instead).',
      );
    }

    const raw = this.readManifestJson(manifestPath);
    const parsed = parseModuleManifest(raw);
    if (!parsed.success) {
      await this.markFailed(key, this.versionOf(raw), raw);
      throw new BadRequestException({
        message: `manifest.json for "${key}" failed schema validation — install rejected, no partial state written.`,
        issues: parsed.issues,
      });
    }

    const crossIssues = await this.validateAgainstPlatform(key, parsed.manifest);
    if (crossIssues.length > 0) {
      await this.markFailed(key, parsed.manifest.version, parsed.manifest);
      throw new BadRequestException({
        message: `Module "${key}" failed install validation — install rejected, no partial state written.`,
        issues: crossIssues,
      });
    }

    const manifest = parsed.manifest;

    // Registry row written BEFORE migrations run (MODULE_SPEC.md §4 step 8 /
    // D15: a crash mid-install resumes as "installing", never silently lost).
    await this.prisma.moduleRegistryEntry.upsert({
      where: { key },
      update: { status: 'installing', version: manifest.version, manifestSnapshot: this.toJson(manifest) },
      create: { key, status: 'installing', version: manifest.version, manifestSnapshot: this.toJson(manifest) },
    });

    try {
      await this.migrationRunner.applyDirectory(join(resolveModulesDir(), key, manifest.migrations.dir), key);
    } catch (error) {
      await this.markFailed(key, manifest.version, manifest);
      throw new InternalServerErrorException(
        `Migrations failed for module "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.registerPermissions(tx, manifest);
      // FIRST INSTALL ONLY — never called from upgrade() (BUILD_PLAN.md risk #4).
      await this.applyDefaultRolePermissions(tx, manifest, installedBy);
      await this.seedSettings(tx, manifest);
      await this.replaceMenuEntries(tx, manifest);
      await tx.moduleRegistryEntry.update({
        where: { key },
        data: {
          status: 'installed',
          installedAt: new Date(),
          version: manifest.version,
          manifestSnapshot: this.toJson(manifest),
        },
      });
    });

    this.i18n.rebuild();
    this.logger.log(`Module "${key}" installed (version ${manifest.version}).`);
    return this.findOrThrow(key);
  }

  // `_upgradedBy` intentionally unused today: upgrade() never grants new
  // permissions by default (BUILD_PLAN.md risk #4), so there is nothing to
  // attribute a grant to. Kept in the signature for symmetry with install()
  // and so the controller doesn't need two different call shapes.
  async upgrade(key: string, _upgradedBy?: string): Promise<PublicModuleEntry> {
    const existing = await this.prisma.moduleRegistryEntry.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Module "${key}" is not registered — install it first`);
    }
    if (!UPGRADABLE_STATUSES.has(existing.status)) {
      throw new ConflictException(`Module "${key}" cannot be upgraded from status "${existing.status}"`);
    }

    const manifestPath = this.manifestPathFor(key);
    if (!existsSync(manifestPath)) {
      throw new NotFoundException(`No manifest.json found for module "${key}" (looked at ${manifestPath})`);
    }

    const raw = this.readManifestJson(manifestPath);
    const parsed = parseModuleManifest(raw);
    if (!parsed.success) {
      await this.markFailed(key, this.versionOf(raw), raw);
      throw new BadRequestException({
        message: `manifest.json for "${key}" failed schema validation — upgrade rejected.`,
        issues: parsed.issues,
      });
    }

    const crossIssues = await this.validateAgainstPlatform(key, parsed.manifest);
    if (crossIssues.length > 0) {
      await this.markFailed(key, parsed.manifest.version, parsed.manifest);
      throw new BadRequestException({
        message: `Module "${key}" failed upgrade validation — upgrade rejected.`,
        issues: crossIssues,
      });
    }

    const manifest = parsed.manifest;

    await this.prisma.moduleRegistryEntry.update({
      where: { key },
      data: { status: 'upgrading', manifestSnapshot: this.toJson(manifest) },
    });

    try {
      // MigrationRunnerService skips already-applied (checksum-matched)
      // files by construction — "only new migrations run" falls out of that
      // for free, no separate upgrade-specific runner needed.
      await this.migrationRunner.applyDirectory(join(resolveModulesDir(), key, manifest.migrations.dir), key);
    } catch (error) {
      await this.markFailed(key, manifest.version, manifest);
      throw new InternalServerErrorException(
        `Migrations failed while upgrading module "${key}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // New permission codes only (skipDuplicates) — deliberately NOT
      // followed by applyDefaultRolePermissions: new permissions introduced
      // by an upgrade get ZERO default grants (MODULE_SPEC.md §5,
      // BUILD_PLAN.md risk #4) so an admin's prior customizations are never
      // silently clobbered.
      await this.registerPermissions(tx, manifest);
      // New setting keys only — upsert no-ops on a key that already exists,
      // so an admin's chosen value is never touched (§8.1).
      await this.seedSettings(tx, manifest);
      await this.replaceMenuEntries(tx, manifest);
      await tx.moduleRegistryEntry.update({
        where: { key },
        data: { status: 'installed', version: manifest.version, manifestSnapshot: this.toJson(manifest) },
      });
    });

    this.i18n.rebuild();
    this.logger.log(`Module "${key}" upgraded to version ${manifest.version} — no new default grants applied.`);
    return this.findOrThrow(key);
  }

  async uninstall(key: string, dropData: boolean): Promise<PublicModuleEntry> {
    if (key === 'core') {
      throw new ForbiddenException('The core pseudo-module can never be uninstalled');
    }
    const existing = await this.prisma.moduleRegistryEntry.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Module "${key}" is not registered`);
    }
    if (!UNINSTALLABLE_STATUSES.has(existing.status)) {
      throw new ConflictException(`Module "${key}" cannot be uninstalled from status "${existing.status}"`);
    }

    await this.prisma.moduleRegistryEntry.update({ where: { key }, data: { status: 'uninstalling' } });

    // De-registered immediately (MODULE_SPEC.md §5): menu rows + the
    // module's own permissions (which CASCADEs to role_permissions — see
    // schema.prisma's RolePermission.permission onDelete: Cascade) are
    // "safe to actually delete... re-created on reinstall".
    await this.prisma.$transaction([
      this.prisma.moduleMenuEntry.deleteMany({ where: { moduleKey: key } }),
      this.prisma.permission.deleteMany({ where: { moduleKey: key } }),
    ]);

    if (dropData) {
      await this.runDownMigrationsIfPresent(key);
    } else {
      this.logger.warn(
        `Module "${key}" uninstalled WITHOUT --drop-data — its own data tables (if any) and its ` +
          'system_settings rows are left in place (D26 safe-by-default).',
      );
    }

    const finalRow = await this.prisma.moduleRegistryEntry.update({ where: { key }, data: { status: 'disabled' } });
    this.i18n.rebuild();
    this.logger.log(`Module "${key}" uninstalled (status left "disabled"; system_settings rows kept per D26).`);
    return toPublicModuleEntry(finalRow);
  }

  /**
   * Called by the CONTROLLER only, after the HTTP response has finished
   * flushing (`res.on('finish', ...)`) — never from inside `install()`/
   * `upgrade()` themselves, so unit tests calling those directly never
   * trigger a real process exit (BUILD_PLAN.md Phase 5 / D15).
   */
  triggerOrchestratedRestart(key: string, verb: 'install' | 'upgrade'): void {
    const lines = [
      `*** Module "${key}" ${verb} succeeded — triggering the D15 orchestrated restart. ***`,
      'The module_registry row already reflects the new state (written BEFORE this exit, per ' +
        'MODULE_SPEC.md §4 step 8), so a crash between now and the container actually restarting resumes ' +
        'as "installed, needs mount" rather than losing the record.',
      "docker-compose's restart: unless-stopped brings the api container back; main.ts's dynamic " +
        `module-mounting loop (module-loader.ts) mounts "${key}" on that next boot.`,
      'Exiting now via process.exit(0) — this IS the deliberate restart mechanism (D15 reinterpretation ' +
        'in DECISIONS.md), not a crash.',
    ];
    this.logger.warn(lines.join(' '));
    process.exit(0);
  }

  // --- Validation ---------------------------------------------------------

  /**
   * Everything MODULE_SPEC.md §4 step 2 requires beyond what the shared Zod
   * schema already self-checks (packages/shared-types/src/module-manifest.ts
   * covers key-prefixing/menu-cycles/settings cross-refs/basePath nesting —
   * all checkable from the manifest text alone). This covers what needs DB
   * or platform state: the manifest key matching the requested key, `ar`
   * inclusion, the compatibleAppVersion RANGE against PLATFORM_VERSION,
   * `dependsOn` all installed, and basePath/apiPrefix collisions.
   */
  private async validateAgainstPlatform(key: string, manifest: ModuleManifest): Promise<ManifestValidationError[]> {
    const issues: ManifestValidationError[] = [];

    if (manifest.key !== key) {
      issues.push({
        path: 'key',
        message: `manifest key "${manifest.key}" does not match the requested module key "${key}"`,
      });
    }

    if (!manifest.locales.supported.includes(DEFAULT_LANGUAGE)) {
      issues.push({
        path: 'locales.supported',
        message: `must include the platform default language "${DEFAULT_LANGUAGE}" (D19) — a module cannot ship without Arabic strings`,
      });
    }

    if (!semver.satisfies(PLATFORM_VERSION, manifest.compatibleAppVersion, { includePrerelease: true })) {
      issues.push({
        path: 'compatibleAppVersion',
        message: `platform version ${PLATFORM_VERSION} does not satisfy range "${manifest.compatibleAppVersion}"`,
      });
    }

    for (const dep of manifest.dependsOn) {
      const depRow = await this.prisma.moduleRegistryEntry.findUnique({ where: { key: dep } });
      if (!depRow || depRow.status !== 'installed') {
        issues.push({ path: 'dependsOn', message: `dependency "${dep}" is not currently installed` });
      }
    }

    const installedRows = await this.prisma.moduleRegistryEntry.findMany({ where: { status: 'installed' } });
    const otherManifests = installedRows
      .filter((row) => row.key !== 'core' && row.key !== key)
      .map((row) => row.manifestSnapshot as unknown as ModuleManifest | null)
      .filter((m): m is ModuleManifest => m !== null && typeof m === 'object');

    const basePaths = [...RESERVED_BASE_PATHS, ...otherManifests.map((m) => m.frontend.basePath)];
    const apiPrefixes = [...RESERVED_API_PREFIXES, ...otherManifests.map((m) => m.backend.apiPrefix)];

    if (basePaths.some((p) => pathsCollide(p, manifest.frontend.basePath))) {
      issues.push({
        path: 'frontend.basePath',
        message: `"${manifest.frontend.basePath}" collides with a reserved core path or an already-installed module`,
      });
    }
    if (apiPrefixes.some((p) => pathsCollide(p, manifest.backend.apiPrefix))) {
      issues.push({
        path: 'backend.apiPrefix',
        message: `"${manifest.backend.apiPrefix}" collides with a reserved core path or an already-installed module`,
      });
    }

    return issues;
  }

  // --- Install/upgrade sub-steps -------------------------------------------

  private async registerPermissions(tx: Prisma.TransactionClient, manifest: ModuleManifest): Promise<void> {
    if (manifest.permissions.length === 0) return;
    await tx.permission.createMany({
      data: manifest.permissions.map((p) => ({
        code: p.code,
        moduleKey: manifest.key,
        category: p.category,
        descriptionI18nKey: p.descriptionKey,
      })),
      skipDuplicates: true,
    });
  }

  /** FIRST INSTALL ONLY — the caller (install()) is what enforces that. */
  private async applyDefaultRolePermissions(
    tx: Prisma.TransactionClient,
    manifest: ModuleManifest,
    grantedBy?: string,
  ): Promise<void> {
    const entries = Object.entries(manifest.defaultRolePermissions);
    if (entries.length === 0) return;

    const allCodes = [...new Set(entries.flatMap(([, codes]) => codes))];
    const permissions = await tx.permission.findMany({ where: { code: { in: allCodes } } });
    const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));

    for (const [roleCode, codes] of entries) {
      if (codes.length === 0) continue;
      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (!role) {
        this.logger.warn(
          `defaultRolePermissions references unknown role "${roleCode}" for module "${manifest.key}" — skipped.`,
        );
        continue;
      }
      for (const code of codes) {
        const permissionId = permissionIdByCode.get(code);
        if (!permissionId) continue; // schema already guarantees the code is declared; defensive only.
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          update: {},
          create: { roleId: role.id, permissionId, grantedBy },
        });
      }
    }
  }

  /**
   * Used by BOTH install() and upgrade(): `upsert` with a no-op `update`
   * means an existing key is NEVER touched, which is exactly "first install
   * only" for a brand new module (every key is new) and exactly "new keys
   * only, existing never touched" for an upgrade — one function satisfies
   * both stated rules (MODULE_SPEC.md §8.1) without two code paths.
   */
  private async seedSettings(tx: Prisma.TransactionClient, manifest: ModuleManifest): Promise<void> {
    for (const setting of manifest.settings) {
      await tx.systemSetting.upsert({
        where: { key: setting.key },
        update: {},
        create: { key: setting.key, value: setting.default as Prisma.InputJsonValue },
      });
    }
  }

  private async replaceMenuEntries(tx: Prisma.TransactionClient, manifest: ModuleManifest): Promise<void> {
    await tx.moduleMenuEntry.deleteMany({ where: { moduleKey: manifest.key } });
    if (manifest.menu.length === 0) return;
    await tx.moduleMenuEntry.createMany({
      data: manifest.menu.map((entry) => ({
        id: entry.id,
        moduleKey: manifest.key,
        labelI18nKey: entry.labelKey,
        icon: entry.icon ?? null,
        parentId: entry.parentId,
        order: entry.order,
        route: entry.route,
        requiredPermission: entry.requiredPermission,
      })),
    });
  }

  // --- Uninstall sub-steps --------------------------------------------------

  /**
   * §5: "--drop-data confirmation that runs a module-provided down migration
   * set if present, otherwise leaves the tables in place... and logs a
   * warning". Down migrations live under `migrations/down/*.sql`, applied in
   * REVERSE filename order (undo the newest migration first), via a plain
   * `pg` client — NOT tracked in `module_migrations` (there's nothing to
   * "skip if already applied" about a teardown). Clears this module's
   * `module_migrations` rows afterward so a future reinstall's up-migrations
   * genuinely recreate everything rather than being skipped as "already
   * applied" against tables that no longer exist.
   */
  private async runDownMigrationsIfPresent(key: string): Promise<void> {
    const downDir = join(resolveModulesDir(), key, 'migrations', 'down');
    if (!existsSync(downDir)) {
      this.logger.warn(
        `--drop-data requested for module "${key}" but it ships no migrations/down/ directory — data tables ` +
          'are left in place (never auto-DROP TABLE without an explicit down-migration the module author wrote).',
      );
      return;
    }
    const files = readdirSync(downDir)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort((a, b) => b.localeCompare(a));
    if (files.length === 0) {
      this.logger.warn(`--drop-data requested for module "${key}" but migrations/down/ is empty — data tables are left in place.`);
      return;
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (const file of files) {
        this.logger.warn(`Running DOWN migration ${key}/migrations/down/${file} (--drop-data)...`);
        await client.query(readFileSync(join(downDir, file), 'utf8'));
      }
    } finally {
      await client.end();
    }
    await this.prisma.moduleMigration.deleteMany({ where: { moduleKey: key } });
  }

  // --- Small helpers ---------------------------------------------------------

  private manifestPathFor(key: string): string {
    return join(resolveModulesDir(), key, 'manifest.json');
  }

  private readManifestJson(manifestPath: string): unknown {
    try {
      return JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new BadRequestException(
        `manifest.json at ${manifestPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private versionOf(raw: unknown): string {
    const v = (raw as { version?: unknown } | null)?.version;
    return typeof v === 'string' && v.length > 0 ? v : 'unknown';
  }

  private toJson(manifest: ModuleManifest): Prisma.InputJsonValue {
    return manifest as unknown as Prisma.InputJsonValue;
  }

  private async markFailed(key: string, version: string, manifestSnapshot: unknown): Promise<void> {
    await this.prisma.moduleRegistryEntry.upsert({
      where: { key },
      update: { status: 'failed', version, manifestSnapshot: manifestSnapshot as Prisma.InputJsonValue },
      create: { key, status: 'failed', version, manifestSnapshot: manifestSnapshot as Prisma.InputJsonValue },
    });
  }

  private async findOrThrow(key: string): Promise<PublicModuleEntry> {
    const row = await this.prisma.moduleRegistryEntry.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`Module "${key}" not found`);
    return toPublicModuleEntry(row);
  }
}
