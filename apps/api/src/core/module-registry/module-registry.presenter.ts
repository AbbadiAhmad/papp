import type { ModuleManifest, ModuleManifestMenuEntry, ModuleManifestRoute } from '@papp/shared-types';
import { ModuleRegistryEntry } from '@prisma/client';

/** Public shape of a `module_registry` row — nothing here is sensitive. */
export interface PublicModuleEntry {
  key: string;
  version: string;
  status: string;
  installedAt: Date | null;
  updatedAt: Date;
  manifestSnapshot: unknown;
  dataDropped: boolean;
}

export function toPublicModuleEntry(row: ModuleRegistryEntry): PublicModuleEntry {
  return {
    key: row.key,
    version: row.version,
    status: row.status,
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
    manifestSnapshot: row.manifestSnapshot,
    dataDropped: row.dataDropped,
  };
}

/**
 * One module package found on disk (`modules/<key>/manifest.json`) that
 * isn't currently active in `module_registry` — i.e. a real candidate for
 * `POST /modules/install`. Feeds the Modules admin page's install dropdown
 * (replacing a free-text key field a caller had to already know/spell
 * correctly) — `modules.view`-gated same as the registry list itself, since
 * `name`/`description`/`version` come straight from each module's own
 * manifest.json and carry the same sensitivity as `PublicModuleEntry`'s
 * `manifestSnapshot`.
 */
export interface AvailableModuleEntry {
  key: string;
  name: string;
  description: string;
  version: string;
}

/**
 * The narrow slice of an installed module's manifest the frontend SHELL
 * needs to mount routes and render the sidebar menu WITHOUT hardcoding any
 * module's name (root DECISIONS.md D78) — never the full `manifestSnapshot`
 * (version/status internals are `modules.view`-gated admin concerns).
 * Deliberately excludes `backend`/`permissions`/`settings`/
 * `defaultRolePermissions` etc. — none of that is needed to decide "does a
 * route/menu-item exist". Still gated behind authentication at the
 * controller (root D79) — even this narrow slice discloses WHICH modules
 * are actually installed for this tenant, which an anonymous caller has no
 * business enumerating.
 */
export interface FrontendModuleManifest {
  key: string;
  basePath: string;
  routes: ModuleManifestRoute[];
  menu: ModuleManifestMenuEntry[];
}

/** `null` when a row's stored `manifestSnapshot` isn't a real manifest object (defensive only — install-time Zod validation already guarantees this in practice). */
export function toFrontendModuleManifest(row: ModuleRegistryEntry): FrontendModuleManifest | null {
  const manifest = row.manifestSnapshot as unknown as ModuleManifest | null;
  if (!manifest || typeof manifest !== 'object' || !manifest.frontend) return null;
  return {
    key: row.key,
    basePath: manifest.frontend.basePath,
    routes: manifest.routes,
    menu: manifest.menu,
  };
}
