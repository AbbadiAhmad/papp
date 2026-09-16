import { Injectable, Logger } from '@nestjs/common';
import type { ModuleManifest } from '@papp/shared-types';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveModulesDir } from '../module-registry/modules-dir';

/** The platform default language (D_A4/D19): the last-resort dictionary. */
export const DEFAULT_LANGUAGE = 'ar';

/** Right-to-left language codes the platform knows about. */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export interface I18nBundle {
  /** The language actually requested (echoed even when nothing shipped for it). */
  lang: string;
  direction: 'rtl' | 'ltr';
  /** Flat dot-namespaced key -> string map, fallback already applied. */
  messages: Record<string, string>;
}

/**
 * Merges core's locale bundles (apps/api/src/core/i18n/locales/<lang>.json)
 * with every INSTALLED module's locale files into one runtime dictionary per
 * language (ARCHITECTURE.md §9, D19). Keys are flat, dot-namespaced under
 * each owner's module key ("core.menu.users", "library_catalog.books.title"),
 * so modules cannot collide with core or each other by construction.
 *
 * Fallback chain per §9: requested language → 'ar' → the literal key. The
 * first two happen here (getBundle overlays the requested language onto the
 * full 'ar' dictionary, so any key missing in the requested language arrives
 * as its Arabic string); the third is the frontend's own behavior when a key
 * is in NEITHER (react-i18next renders the literal key — visibly broken on
 * purpose, easy to spot in QA).
 *
 * Dictionaries are built once, lazily, on first request: module locale sets
 * only change on install/upgrade/uninstall, each of which is followed by the
 * D15 orchestrated process restart — so a boot-time snapshot is always
 * current. `rebuild()` exists for completeness/tests.
 */
@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  /** lang -> merged flat dictionary. Null until first build. */
  private dictionaries: Map<string, Record<string, string>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getBundle(lang: string): Promise<I18nBundle> {
    const dictionaries = await this.getDictionaries();
    const requested = dictionaries.get(lang) ?? {};
    const fallback = dictionaries.get(DEFAULT_LANGUAGE) ?? {};
    return {
      lang,
      direction: RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr',
      // Requested language wins key-by-key; anything it lacks falls back to
      // Arabic. For an unknown language this degrades to the full 'ar'
      // dictionary — never an empty screen on the login page.
      messages: { ...fallback, ...requested },
    };
  }

  /** Languages that have at least one string (core's plus any module extras). */
  async availableLanguages(): Promise<string[]> {
    const dictionaries = await this.getDictionaries();
    return [...dictionaries.keys()].sort();
  }

  /** Drops the built dictionaries; the next request rebuilds from disk + DB. */
  rebuild(): void {
    this.dictionaries = null;
  }

  private async getDictionaries(): Promise<Map<string, Record<string, string>>> {
    if (this.dictionaries) return this.dictionaries;

    const dictionaries = new Map<string, Record<string, string>>();

    // 1. Core bundles — shipped next to this file (copied into dist by the
    //    nest-cli assets rule, same mechanism as core/migrations/*.sql).
    const coreDir = join(__dirname, 'locales');
    for (const [lang, messages] of this.readLocaleDir(coreDir, 'core')) {
      dictionaries.set(lang, { ...(dictionaries.get(lang) ?? {}), ...messages });
    }
    if (!dictionaries.has(DEFAULT_LANGUAGE)) {
      // Arabic is the fallback everything relies on — its absence is a build/
      // packaging bug worth failing loudly over.
      throw new Error(`Core '${DEFAULT_LANGUAGE}' locale bundle is missing from ${coreDir}`);
    }

    // 2. Every installed module's bundles, from its manifest snapshot's
    //    locales dir (MODULE_SPEC.md §4 step 6). Modules that fail to read
    //    are logged and skipped — a broken locale file must not take down
    //    the login screen's strings.
    const installed = await this.prisma.moduleRegistryEntry.findMany({
      where: { status: 'installed', NOT: { key: 'core' } },
    });
    const modulesDir = resolveModulesDir();
    for (const entry of installed) {
      const manifest = entry.manifestSnapshot as unknown as ModuleManifest | null;
      if (!manifest?.locales?.dir) continue;
      const dir = join(modulesDir, entry.key, manifest.locales.dir);
      for (const [lang, messages] of this.readLocaleDir(dir, entry.key)) {
        dictionaries.set(lang, { ...(dictionaries.get(lang) ?? {}), ...messages });
      }
    }

    this.dictionaries = dictionaries;
    this.logger.log(
      `i18n dictionaries built: [${[...dictionaries.keys()].sort().join(', ')}] ` +
        `(core + ${installed.length} installed module(s))`,
    );
    return dictionaries;
  }

  /** Reads every `<lang>.json` in `dir` as a flat string map. */
  private readLocaleDir(dir: string, owner: string): Array<[string, Record<string, string>]> {
    if (!existsSync(dir)) {
      if (owner !== 'core') this.logger.warn(`Locale dir for module "${owner}" not found at ${dir} — skipped.`);
      return [];
    }
    const results: Array<[string, Record<string, string>]> = [];
    for (const filename of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const lang = filename.slice(0, -'.json'.length);
      try {
        const parsed = JSON.parse(readFileSync(join(dir, filename), 'utf8')) as Record<string, unknown>;
        const flat: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') flat[key] = value;
        }
        results.push([lang, flat]);
      } catch (error) {
        this.logger.error(
          `Failed to read locale file ${join(dir, filename)} for "${owner}" — skipped.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return results;
  }
}
