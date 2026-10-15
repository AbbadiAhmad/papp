/**
 * Survey images (modules/survey/ROADMAP.md, phase D). Framework-free like the other rule files:
 * the server validates uploads with it (the reference shape, `parseImageRef`, lives in question-rules.ts
 * so the builder can share it).
 *
 * An image is referenced from three places — the survey header (`settings.headerImage`), a
 * section (`survey_sections.image`) and a question (`config.image`) — always as
 * `{ mediaId, alt }`. The bytes live in a disk volume (SURVEY-D18), never in the database.
 */

import { MAX_IMAGE_BYTES, parseImageRef } from './question-rules';

export { MAX_IMAGE_BYTES };
export const MAX_IMAGES_PER_SURVEY = 100;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * The type is decided from the file's own first bytes — never from the file name or the
 * browser-declared type, which a caller controls. SVG is deliberately not accepted (it can carry
 * scripts); only PNG, JPEG and WebP.
 */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && // RIFF
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

export function extensionForMime(mime: ImageMime): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}

export function mimeForExtension(ext: string): ImageMime | null {
  const e = ext.toLowerCase();
  return e === 'png' ? 'image/png' : e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : null;
}

/** English text of the first problem with an uploaded file, or null when it is acceptable. */
export function validateImageUpload(bytes: Uint8Array | undefined | null): { mime: ImageMime } | { error: string } {
  if (!bytes || bytes.length === 0) return { error: 'No image was uploaded' };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: `The image is too large (at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)` };
  const mime = detectImageMime(bytes);
  if (!mime) return { error: 'Only PNG, JPEG or WebP images are accepted' };
  return { mime };
}

/** Every media id referenced by a structure/settings tree (for ownership checks and cleanup). */
export function collectMediaIds(parts: {
  headerImage?: unknown;
  sections?: Array<{ image?: unknown; questions?: Array<{ config?: Record<string, unknown> | null }> }>;
}): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    const parsed = parseImageRef(v);
    if ('ref' in parsed && parsed.ref) ids.add(parsed.ref.mediaId);
  };
  add(parts.headerImage);
  for (const s of parts.sections ?? []) {
    add(s.image);
    for (const q of s.questions ?? []) add(q.config?.image);
  }
  return [...ids];
}
