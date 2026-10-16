import { BlobReader, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
import { createWriteStream, mkdirSync, openAsBlob } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FILES_MEMBER_PREFIX, resolveRestoreTarget, type FileRoot } from './backup-files';

/**
 * Writes the uploaded files from an "Export files" archive back into `roots` (used by
 * `cli-db.js restore-files`). Existing files with the same path are overwritten; nothing is deleted.
 * Members for an unknown root or with a path that would leave its root are skipped. The archive is read
 * lazily from disk and each file is streamed out, because the archive can be many gigabytes.
 */
export async function restoreFilesArchive(file: string, password: string, roots: FileRoot[]): Promise<{ restored: number; skipped: number }> {
  const reader = new ZipReader(new BlobReader(await openAsBlob(file)), { password });
  let restored = 0;
  let skipped = 0;
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.filename.startsWith(FILES_MEMBER_PREFIX)) continue;
      const target = resolveRestoreTarget(entry.filename, roots);
      if (!target) {
        console.warn(`Skipping "${entry.filename}": unknown directory or unsafe path.`);
        skipped += 1;
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const done = pipeline(Readable.fromWeb(readable as never), createWriteStream(target));
      done.catch(() => undefined); // a failed decrypt aborts the stream; the getData error below is the one reported
      try {
        await (entry as FileEntry).getData({ writable } as never, { password });
      } catch (error) {
        await writable.abort(error).catch(() => undefined);
        throw error;
      }
      await done;
      restored += 1;
    }
  } finally {
    await reader.close();
  }
  return { restored, skipped };
}

export type { Entry };
