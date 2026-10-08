import { Injectable, Logger } from '@nestjs/common';
import { type ThemePack, themePackSchema } from '@papp/shared-types';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveThemesDir } from './themes-dir';

/**
 * Discovers theme packs on disk. Read per call (a handful of tiny JSON files,
 * admin-page and login-page traffic only) so dropping a new folder into
 * `themes/` is picked up without restarting the api. A pack that fails schema
 * validation, or whose folder name differs from its `key`, is skipped and
 * logged — one broken pack never breaks the others or the login page.
 */
@Injectable()
export class ThemesService {
  private readonly logger = new Logger(ThemesService.name);

  async listThemes(): Promise<ThemePack[]> {
    const dir = resolveThemesDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const themes: ThemePack[] = [];
    for (const entry of entries.sort()) {
      const theme = await this.readPack(dir, entry);
      if (theme) themes.push(theme);
    }
    return themes;
  }

  async findTheme(key: string): Promise<ThemePack | null> {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return null;
    return this.readPack(resolveThemesDir(), key);
  }

  private async readPack(dir: string, folder: string): Promise<ThemePack | null> {
    try {
      const raw = JSON.parse(await readFile(join(dir, folder, 'theme.json'), 'utf8')) as unknown;
      const parsed = themePackSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(`Theme pack "${folder}" skipped: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        return null;
      }
      if (parsed.data.key !== folder) {
        this.logger.warn(`Theme pack folder "${folder}" skipped: its key is "${parsed.data.key}" (they must match).`);
        return null;
      }
      return parsed.data;
    } catch {
      return null; // not a theme folder (no/invalid theme.json)
    }
  }
}
