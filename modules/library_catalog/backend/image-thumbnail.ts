import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, parse } from 'path';

/** Longest side of a thumbnail, in px (LIBRARY_CATALOG-D39). Big enough for a card at 2x density. */
export const THUMB_SIDE = 400;
/**
 * Refuse to decode pictures larger than this many pixels (~40 MP; a phone photo is 12-50 MP). A 5 MB upload can
 * be a tiny compressed file that expands to billions of pixels ("decompression bomb"), and the thumbnail route is
 * public, so the decoder must never be allowed to allocate that. Such a picture is simply served as-is.
 */
export const MAX_INPUT_PIXELS = 40_000_000;
/** At most this many thumbnails are being generated at once; the rest wait. Bounds CPU/memory on a public route. */
const MAX_PARALLEL = 2;

let running = 0;
const waiting: Array<() => void> = [];
/** Same picture requested many times at once (a page of cards, a refresh storm) is generated once. */
const inFlight = new Map<string, Promise<string | null>>();

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * Returns the path of a small WebP copy of `original`, creating it on first use and caching it in a
 * `thumbs/` folder next to the picture. The cache name carries the original's size and mtime, so a
 * replaced picture gets a fresh thumbnail. Returns null whenever a thumbnail cannot be made (animated GIF,
 * oversize or unreadable file, sharp unavailable) — the caller then serves the original, so this never breaks a page.
 * `original` always comes from a database row, never from the request.
 */
export async function thumbnailFor(original: string, mime: string): Promise<string | null> {
  if (mime === 'image/gif') return null; // may be animated; keep as is
  try {
    const stat = await fs.stat(original);
    const dir = join(dirname(original), 'thumbs');
    const name = `${parse(original).name}-${stat.size}-${Math.round(stat.mtimeMs)}.webp`;
    const target = join(dir, name);
    if (await fs.stat(target).then((s) => s.isFile(), () => false)) return target;

    const pending = inFlight.get(target) ?? slot(() => generate(original, dir, name, target)).finally(() => inFlight.delete(target));
    inFlight.set(target, pending);
    return await pending;
  } catch {
    return null;
  }
}

async function generate(original: string, dir: string, name: string, target: string): Promise<string | null> {
  const temp = join(dir, `${randomUUID()}.tmp`); // unique, so two workers can never write the same temp file
  try {
    const sharp = (await import('sharp')).default;
    await fs.mkdir(dir, { recursive: true });
    await sharp(original, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
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
    await fs.rm(temp, { force: true });
    return null;
  }
}
