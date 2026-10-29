"use strict";
/**
 * Book cover pictures and book files (LIBRARY_CATALOG-D28). Framework-free so the service and the
 * unit tests share it. The file TYPE is decided from the file's own bytes, never from the uploaded
 * name or the browser-declared type, and the uploaded name is never stored or used on disk: files
 * are always called `cover.<ext>` / `book.<ext>` inside the book's folder.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOK_FILE_KINDS = exports.MAX_BOOK_FILE_BYTES = exports.MAX_IMAGES_PER_BOOK = exports.MAX_COVER_BYTES = void 0;
exports.detectCover = detectCover;
exports.detectBookFile = detectBookFile;
exports.validateUpload = validateUpload;
exports.downloadName = downloadName;
exports.MAX_COVER_BYTES = 5 * 1024 * 1024;
/** Extra gallery pictures per book (LIBRARY_CATALOG-D30). */
exports.MAX_IMAGES_PER_BOOK = 10;
exports.MAX_BOOK_FILE_BYTES = 30 * 1024 * 1024;
exports.BOOK_FILE_KINDS = ['cover', 'book'];
const ascii = (bytes, start, text) => {
    if (bytes.length < start + text.length)
        return false;
    for (let i = 0; i < text.length; i += 1)
        if (bytes[start + i] !== text.charCodeAt(i))
            return false;
    return true;
};
/** Pictures every browser shows natively. SVG is refused on purpose (it can carry scripts). */
function detectCover(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG') && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return { ext: 'jpg', mime: 'image/jpeg' };
    if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP'))
        return { ext: 'webp', mime: 'image/webp' };
    if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))
        return { ext: 'gif', mime: 'image/gif' };
    if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')))
        return { ext: 'avif', mime: 'image/avif' };
    return null;
}
/**
 * Book formats: PDF; EPUB (the open format Apple Books and most readers use); MOBI / AZW3 without DRM
 * (Amazon's "BOOKMOBI" container — DRM-protected or KFX files cannot be recognised and are refused);
 * and Markdown / plain text (valid UTF-8, no NUL bytes).
 */
function detectBookFile(bytes) {
    if (ascii(bytes, 0, '%PDF-'))
        return { ext: 'pdf', mime: 'application/pdf' };
    if (bytes.length >= 58 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && ascii(bytes, 30, 'mimetype') && ascii(bytes, 38, 'application/epub+zip')) {
        return { ext: 'epub', mime: 'application/epub+zip' };
    }
    if (ascii(bytes, 60, 'BOOKMOBI'))
        return { ext: 'azw3', mime: 'application/x-mobipocket-ebook' };
    if (bytes.length > 0 && !bytes.includes(0)) {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return { ext: 'md', mime: 'text/markdown; charset=utf-8' };
        }
        catch {
            return null;
        }
    }
    return null;
}
function validateUpload(kind, bytes) {
    if (!bytes || bytes.length === 0)
        return { error: 'No file was uploaded' };
    const limit = kind === 'cover' ? exports.MAX_COVER_BYTES : exports.MAX_BOOK_FILE_BYTES;
    if (bytes.length > limit)
        return { error: `The file is too large (at most ${limit / (1024 * 1024)} MB)` };
    const file = kind === 'cover' ? detectCover(bytes) : detectBookFile(bytes);
    if (!file) {
        return {
            error: kind === 'cover' ? 'Only PNG, JPEG, WebP, GIF or AVIF pictures are accepted' : 'Only PDF, EPUB, AZW3/MOBI (without DRM) or Markdown/text books are accepted',
        };
    }
    return { file };
}
/** A download name derived from the book title (never from the uploaded file name): safe characters only. */
function downloadName(title, ext) {
    const cleaned = title.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
    const asciiName = cleaned.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim() || 'book';
    return { ascii: `${asciiName}.${ext}`, utf8: `${cleaned}.${ext}` };
}
