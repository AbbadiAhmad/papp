import { promises as fs } from 'fs';
import { dirname, join, parse } from 'path';

/** Longest side of a thumbnail, in px (LIBRARY_CATALOG-D39). Big enough for a card at 2x density. */
export const THUMB_SIDE = 400;

/**
 * Returns the path of a small WebP copy of `original`, creating it on first use and caching it in a
 * `thumbs/` folder next to the picture. The cache name carries the original's size and mtime, so a
 * replaced picture gets a fresh thumbnail. Returns null whenever a thumbnail cannot be made (animated GIF,
 * unreadable file, sharp unavailable) — the caller then serves the original, so this never breaks a page.
 */
export async function thumbnailFor(original: string, mime: string): Promise<string | null> {
  if (mime === 'image/gif') return null; // may be animated; keep as is
  try {
    const stat = await fs.stat(original);
    const dir = join(dirname(original), 'thumbs');
    const name = `${parse(original).name}-${stat.size}-${Math.round(stat.mtimeMs)}.webp`;
    const target = join(dir, name);
    if (await fs.stat(target).then((s) => s.isFile(), () => false)) return target;

    const sharp = (await import('sharp')).default;
    await fs.mkdir(dir, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await sharp(original, { failOn: 'none' })
      .rotate() // honour the EXIF orientation of phone photos
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(temp);
    await fs.rename(temp, target);
    // Drop thumbnails of earlier versions of the same picture.
    const prefix = `${parse(original).name}-`;
    for (const file of await fs.readdir(dir)) if (file.startsWith(prefix) && file !== name && file.endsWith('.webp')) await fs.rm(join(dir, file), { force: true });
    return target;
  } catch {
    return null;
  }
}
