import { ModuleRegistryEntry } from '@prisma/client';

/** Public shape of a `module_registry` row — nothing here is sensitive. */
export interface PublicModuleEntry {
  key: string;
  version: string;
  status: string;
  installedAt: Date | null;
  updatedAt: Date;
  manifestSnapshot: unknown;
}

export function toPublicModuleEntry(row: ModuleRegistryEntry): PublicModuleEntry {
  return {
    key: row.key,
    version: row.version,
    status: row.status,
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
    manifestSnapshot: row.manifestSnapshot,
  };
}
