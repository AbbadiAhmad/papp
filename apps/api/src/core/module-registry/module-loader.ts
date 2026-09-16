import { Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { resolveModulesDir } from './modules-dir';

const logger = new Logger('ModuleLoader');

export interface DiscoveredModule {
  key: string;
  /** Whatever the entry file exported — expected to be a Nest module class. */
  moduleClass: unknown;
}

/**
 * Runs BEFORE `NestFactory.create()` (main.ts) — Nest builds its DI/module
 * graph exactly once at that call, with no supported in-process hot-swap
 * (D15 reinterpretation, BUILD_PLAN.md risk #9), so every module that should
 * be live this boot must already be in the array passed to `NestFactory`.
 *
 * Reads `module_registry` directly via a plain `pg` client (mirrors main.ts's
 * `bootstrapRegistryTables`) rather than through Prisma/DI, because neither
 * exists yet at this point in bootstrap.
 *
 * Defensive by construction: a module that fails to import, or whose entry
 * doesn't export something usable as a Nest module class, is logged loudly
 * and SKIPPED — never allowed to take down the whole platform's boot. This
 * is what lets main.ts truthfully log "N modules mounted" (N can be less
 * than the number of `installed` rows if one is malformed) instead of dying.
 */
export async function discoverInstalledModules(): Promise<DiscoveredModule[]> {
  const rows = await queryInstalledModuleRows();
  const modulesDir = resolveModulesDir();
  const discovered: DiscoveredModule[] = [];

  for (const row of rows) {
    const manifest = row.manifest_snapshot as { backend?: { entry?: unknown } } | null;
    const entry = manifest?.backend?.entry;
    if (typeof entry !== 'string' || entry.length === 0) {
      logger.error(
        `Module "${row.key}" has status='installed' but no usable backend.entry in its manifest snapshot — skipped.`,
      );
      continue;
    }

    const entryPath = join(modulesDir, row.key, entry);
    if (!existsSync(entryPath)) {
      logger.error(`Module "${row.key}"'s backend entry "${entryPath}" does not exist on disk — skipped.`);
      continue;
    }

    try {
      const imported = (await import(entryPath)) as Record<string, unknown>;
      const candidate = pickModuleCandidate(imported);
      if (typeof candidate !== 'function') {
        logger.error(
          `Module "${row.key}"'s backend entry (${entryPath}) did not export a usable Nest module class — skipped.`,
        );
        continue;
      }
      discovered.push({ key: row.key, moduleClass: candidate });
      logger.log(`Loaded backend module for "${row.key}" from ${entryPath}`);
    } catch (error) {
      logger.error(
        `Failed to import backend entry for module "${row.key}" (${entryPath}) — skipped, boot continues.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  return discovered;
}

async function queryInstalledModuleRows(): Promise<Array<{ key: string; manifest_snapshot: unknown }>> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ key: string; manifest_snapshot: unknown }>(
      "SELECT key, manifest_snapshot FROM module_registry WHERE status = 'installed' AND key <> 'core'",
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Prefers a default export; otherwise the first exported function (class). */
function pickModuleCandidate(imported: Record<string, unknown>): unknown {
  if (typeof imported.default === 'function') return imported.default;
  return Object.values(imported).find((value) => typeof value === 'function');
}
