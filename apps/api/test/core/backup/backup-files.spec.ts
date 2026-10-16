import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFilesRecursive, parseFileRoots, resolveRestoreTarget } from '../../../src/core/backup/backup-files';
import { restoreFilesArchive } from '../../../src/core/backup/backup-files-restore';
import { BackupService } from '../../../src/core/backup/backup.service';

/** Real archiver + real zip.js round trip on temp directories; only the database (never touched by the files export) is absent. */

describe('parseFileRoots', () => {
  it('parses name=dir pairs and drops invalid or duplicate entries', () => {
    expect(parseFileRoots('books_files=/data/books_files, survey_media=/data/survey-media')).toEqual([
      { name: 'books_files', dir: '/data/books_files' },
      { name: 'survey_media', dir: '/data/survey-media' },
    ]);
    expect(parseFileRoots('a=relative/dir,bad name=/x,=/y,c=/z,c=/other')).toEqual([{ name: 'c', dir: '/z' }]);
    expect(parseFileRoots(undefined)).toEqual([]);
    expect(parseFileRoots('')).toEqual([]);
  });
});

describe('resolveRestoreTarget', () => {
  const roots = [{ name: 'books_files', dir: '/data/books_files' }];
  it('maps a member into its root', () => {
    expect(resolveRestoreTarget('files/books_files/abc/cover.jpg', roots)).toBe('/data/books_files/abc/cover.jpg');
  });
  it('refuses unknown roots, traversal, absolute and odd paths', () => {
    expect(resolveRestoreTarget('files/other/x.jpg', roots)).toBeNull();
    expect(resolveRestoreTarget('files/books_files/../../etc/passwd', roots)).toBeNull();
    expect(resolveRestoreTarget('files/books_files//etc/passwd', roots)).toBeNull();
    expect(resolveRestoreTarget('files/books_files/a\\b', roots)).toBeNull();
    expect(resolveRestoreTarget('files/books_files/', roots)).toBeNull();
    expect(resolveRestoreTarget('dump.pgcustom', roots)).toBeNull();
  });
});

describe('files export and restore (real archive)', () => {
  const work = mkdtempSync(join(tmpdir(), 'papp-files-test-'));
  const booksDir = join(work, 'books_files');
  const mediaDir = join(work, 'survey-media');
  const archivePath = join(work, 'files.zip');
  const originalEnv = { pw: process.env.BACKUP_ENCRYPTION_PASSWORD, dirs: process.env.BACKUP_FILE_DIRS };
  const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 255, 254]);

  beforeAll(() => {
    mkdirSync(join(booksDir, 'book-1'), { recursive: true });
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(booksDir, 'book-1', 'book.pdf'), binary);
    writeFileSync(join(booksDir, 'book-1', 'info.txt'), 'Title: A book');
    writeFileSync(join(mediaDir, 'pic.png'), Buffer.from([0x89, 0x50]));
    symlinkSync('/etc/passwd', join(booksDir, 'link.txt'));
    process.env.BACKUP_ENCRYPTION_PASSWORD = 'test-password';
    process.env.BACKUP_FILE_DIRS = `books_files=${booksDir},survey_media=${mediaDir}`;
  });

  afterAll(() => {
    process.env.BACKUP_ENCRYPTION_PASSWORD = originalEnv.pw;
    process.env.BACKUP_FILE_DIRS = originalEnv.dirs;
    rmSync(work, { recursive: true, force: true });
  });

  it('lists files recursively and skips symlinks', () => {
    expect(listFilesRecursive(booksDir)).toEqual(['book-1/book.pdf', 'book-1/info.txt']);
    expect(listFilesRecursive(join(work, 'missing'))).toEqual([]);
  });

  it('refuses to export when no password is configured', async () => {
    delete process.env.BACKUP_ENCRYPTION_PASSWORD;
    const service = new BackupService({} as never);
    await expect(service.exportFiles('u', createWriteStream(join(work, 'x.zip')))).rejects.toThrow();
    process.env.BACKUP_ENCRYPTION_PASSWORD = 'test-password';
  });

  it('exports an encrypted archive and restores byte-identical files into emptied directories', async () => {
    const service = new BackupService({} as never);
    const result = await service.exportFiles('user-1', createWriteStream(archivePath));
    expect(result.fileCount).toBe(3);
    // not readable without the right password
    await expect(restoreFilesArchive(archivePath, 'wrong', parseFileRoots(`books_files=${join(work, 'r0')}`))).rejects.toThrow();

    const restoreRoot = join(work, 'restored');
    const roots = parseFileRoots(`books_files=${join(restoreRoot, 'books')},survey_media=${join(restoreRoot, 'media')}`);
    const outcome = await restoreFilesArchive(archivePath, 'test-password', roots);
    expect(outcome).toEqual({ restored: 3, skipped: 0 });
    expect(readFileSync(join(restoreRoot, 'books', 'book-1', 'book.pdf')).equals(binary)).toBe(true);
    expect(readFileSync(join(restoreRoot, 'books', 'book-1', 'info.txt'), 'utf8')).toBe('Title: A book');
    expect(existsSync(join(restoreRoot, 'media', 'pic.png'))).toBe(true);
    expect(existsSync(join(restoreRoot, 'books', 'link.txt'))).toBe(false);
  });

  it('skips archive members whose root is not configured on the restoring server', async () => {
    const roots = parseFileRoots(`books_files=${join(work, 'only-books')}`);
    const outcome = await restoreFilesArchive(archivePath, 'test-password', roots);
    expect(outcome).toEqual({ restored: 2, skipped: 1 });
  });
});
