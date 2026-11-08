import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { MAX_INPUT_PIXELS, THUMB_SIDE, thumbnailFor } from '../../backend/image-thumbnail';

describe('thumbnailFor (public route: must be bounded)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thumb-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('makes one small WebP, shared by simultaneous requests, with no temp files left', async () => {
    const file = join(dir, 'cover.jpg');
    await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#c33' } }).jpeg().toFile(file);
    const results = await Promise.all([1, 2, 3, 4].map(() => thumbnailFor(file, 'image/jpeg')));
    expect(new Set(results).size).toBe(1);
    const meta = await sharp(results[0] as string).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(THUMB_SIDE);
    expect((await readdir(join(dir, 'thumbs'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a picture above the pixel limit (decompression bomb) and leaves the original to be served', async () => {
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 500;
    const file = join(dir, 'bomb.png');
    await sharp({ limitInputPixels: false, create: { width: side, height: side, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toFile(file);
    expect(await thumbnailFor(file, 'image/png')).toBeNull();
  });

  it('never touches animated-capable GIFs or missing files', async () => {
    expect(await thumbnailFor(join(dir, 'a.gif'), 'image/gif')).toBeNull();
    expect(await thumbnailFor(join(dir, 'missing.jpg'), 'image/jpeg')).toBeNull();
  });
});
