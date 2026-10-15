import { describe, expect, it } from '@jest/globals';
import { detectBookFile, detectCover, downloadName, MAX_BOOK_FILE_BYTES, MAX_COVER_BYTES, validateUpload } from '../../backend/book-file-rules';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);
const withAt = (offset: number, ascii: string, total = 100) => {
  const out = new Uint8Array(total);
  out.set(text(ascii), offset);
  return out;
};

describe('cover detection (from the bytes only)', () => {
  it('recognises the pictures browsers show natively', () => {
    expect(detectCover(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.ext).toBe('png');
    expect(detectCover(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe('jpg');
    expect(detectCover(text('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
    expect(detectCover(text('GIF89a....'))?.ext).toBe('gif');
    expect(detectCover(new Uint8Array([0, 0, 0, 0x1c, ...text('ftypavif')]))?.ext).toBe('avif');
  });
  it('refuses SVG, HTML, PDF and short input', () => {
    expect(detectCover(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectCover(text('<html></html>'))).toBeNull();
    expect(detectCover(text('%PDF-1.7'))).toBeNull();
    expect(detectCover(bytes(0x89, 0x50))).toBeNull();
  });
});

describe('book file detection', () => {
  it('recognises PDF, EPUB, AZW3/MOBI and Markdown/text', () => {
    expect(detectBookFile(text('%PDF-1.7\n'))?.ext).toBe('pdf');
    const epub = new Uint8Array(80);
    epub.set([0x50, 0x4b, 0x03, 0x04]);
    epub.set(text('mimetype'), 30);
    epub.set(text('application/epub+zip'), 38);
    expect(detectBookFile(epub)).toEqual({ ext: 'epub', mime: 'application/epub+zip' });
    expect(detectBookFile(withAt(60, 'BOOKMOBI'))?.ext).toBe('azw3');
    expect(detectBookFile(text('# Title\n\nمرحبا بالعالم'))?.ext).toBe('md');
  });
  it('refuses a plain zip, executables, binary data and invalid UTF-8', () => {
    expect(detectBookFile(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0))).toBeNull();
    expect(detectBookFile(bytes(0x4d, 0x5a, 0x90, 0, 3))).toBeNull();
    expect(detectBookFile(bytes(0xff, 0xfe, 0xfd, 0x80))).toBeNull();
    expect(detectBookFile(new Uint8Array())).toBeNull();
  });
});

describe('validateUpload', () => {
  it('applies the per-kind size limit and type check', () => {
    expect(validateUpload('cover', text('GIF89a'))).toHaveProperty('file');
    expect(validateUpload('book', text('%PDF-'))).toHaveProperty('file');
    expect(validateUpload('book', undefined)).toHaveProperty('error');
    expect(validateUpload('cover', text('%PDF-'))).toHaveProperty('error');
    const bigCover = new Uint8Array(MAX_COVER_BYTES + 1);
    bigCover.set(bytes(0xff, 0xd8, 0xff));
    expect(validateUpload('cover', bigCover)).toHaveProperty('error');
    const okBook = new Uint8Array(MAX_COVER_BYTES + 1);
    okBook.set(text('%PDF-'));
    expect(validateUpload('book', okBook)).toHaveProperty('file'); // books may be bigger than covers
    const bigBook = new Uint8Array(MAX_BOOK_FILE_BYTES + 1);
    bigBook.set(text('%PDF-'));
    expect(validateUpload('book', bigBook)).toHaveProperty('error');
  });
});

describe('downloadName', () => {
  it('is built from the title with unsafe characters removed', () => {
    expect(downloadName('The Hobbit: There/and "Back" Again', 'pdf')).toEqual({ ascii: 'The Hobbit There and Back Again.pdf', utf8: 'The Hobbit There and Back Again.pdf' });
    expect(downloadName('../../etc/passwd', 'md').utf8).toBe('.. .. etc passwd.md');
    expect(downloadName('كتاب جميل', 'epub')).toEqual({ ascii: 'book.epub', utf8: 'كتاب جميل.epub' });
    expect(downloadName('   ', 'pdf').ascii).toBe('book.pdf');
  });
});
