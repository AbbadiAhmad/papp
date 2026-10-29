/**
 * Shrinks a picture in the browser before it is uploaded (LIBRARY_CATALOG-D30): longest side at most
 * MAX_SIDE px, re-encoded as WebP (JPEG where WebP encoding is unavailable). Anything that cannot be decoded
 * here (an AVIF the browser can't draw, an animated GIF) or that would not get smaller is sent unchanged, so
 * compression never blocks an upload; the server still checks the type and size of whatever arrives.
 */
export const MAX_SIDE = 1200;
const QUALITY = 0.82;
// Small files are not worth re-encoding (and re-encoding them can make them bigger).
const SKIP_BELOW_BYTES = 120 * 1024;

export async function compressImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.size < SKIP_BELOW_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
    // Safari can't encode WebP and silently hands back a PNG, which would be larger.
    if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'picture'}.${extension}`, { type: blob.type });
  } catch {
    return file;
  }
}
