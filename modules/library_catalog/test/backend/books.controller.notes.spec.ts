import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { BooksController } from '../../backend/books.controller';

const user = { userId: 'u1', sessionId: 's1', email: 'a@x.test', mustChangePassword: false };

/** Internal notes are staff-only (LIBRARY_CATALOG-D35): read and write both hinge on `library_catalog.notes.view`. */
describe('BooksController — internal notes', () => {
  let books: Record<string, jest.Mock>;
  let files: Record<string, jest.Mock>;
  let importer: Record<string, jest.Mock>;
  let codes: Set<string>;
  let controller: BooksController;

  beforeEach(() => {
    books = {
      list: jest.fn(async () => []),
      findById: jest.fn(async () => ({ id: 'b1' })),
      listCopies: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: 'b1' })),
      update: jest.fn(async () => ({ id: 'b1' })),
      createCopy: jest.fn(async () => ({ id: 'c1' })),
      updateCopy: jest.fn(async () => ({ id: 'c1' })),
      exportBooksWorkbook: jest.fn(async () => Buffer.from('x')),
      exportCopiesForInventoryWorkbook: jest.fn(async () => Buffer.from('x')),
    };
    files = { summaries: jest.fn(async () => new Map()), summary: jest.fn(async () => ({})), writeInfo: jest.fn(async () => undefined) };
    importer = { preview: jest.fn(async () => ({})), commit: jest.fn(async () => ({})) };
    codes = new Set(['library_catalog.books.view']);
    const permissions = { getEffectivePermissionCodes: jest.fn(async () => codes) };
    controller = new BooksController(books as never, files as never, importer as never, permissions as never);
  });

  const res = () => ({ set: jest.fn(), send: jest.fn() }) as never;

  it('reads: notes are requested from the service only for a caller who holds notes.view', async () => {
    await controller.list({} as never, user);
    expect(books.list).toHaveBeenLastCalledWith({}, false);
    await controller.findById('b1', user);
    expect(books.findById).toHaveBeenLastCalledWith('b1', 'u1', false);
    await controller.listCopies('b1', user);
    expect(books.listCopies).toHaveBeenLastCalledWith('b1', false);

    codes.add('library_catalog.notes.view');
    await controller.list({} as never, user);
    expect(books.list).toHaveBeenLastCalledWith({}, true);
    await controller.findById('b1', user);
    expect(books.findById).toHaveBeenLastCalledWith('b1', 'u1', true);
    await controller.listCopies('b1', user);
    expect(books.listCopies).toHaveBeenLastCalledWith('b1', true);
  });

  it('exports and imports carry notes only for a caller who holds notes.view', async () => {
    await controller.export(res(), user);
    expect(books.exportBooksWorkbook).toHaveBeenLastCalledWith({}, false);
    await controller.exportCopiesForInventory({}, res(), user);
    expect(books.exportCopiesForInventoryWorkbook).toHaveBeenLastCalledWith({}, false);
    await controller.importPreview(user, { buffer: Buffer.from('x') });
    expect(importer.preview).toHaveBeenLastCalledWith(expect.anything(), false);
    await controller.importCommit(user, { buffer: Buffer.from('x') }, JSON.stringify({ books: {} }));
    expect(importer.commit).toHaveBeenLastCalledWith(expect.anything(), { books: {} }, false);

    codes.add('library_catalog.notes.view');
    await controller.export(res(), user);
    expect(books.exportBooksWorkbook).toHaveBeenLastCalledWith({}, true);
    await controller.exportCopiesForInventory({}, res(), user);
    expect(books.exportCopiesForInventoryWorkbook).toHaveBeenLastCalledWith({}, true);
    await controller.importPreview(user, { buffer: Buffer.from('x') });
    expect(importer.preview).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  it('writes: a note without notes.view is refused (403) before anything is saved, on every write path', async () => {
    await expect(controller.create({ title: 'T', internalNote: 'secret', copy: {} } as never, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.create({ title: 'T', copy: { internalNote: 'secret' } } as never, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.update('b1', { internalNote: '' } as never, user)).rejects.toBeInstanceOf(ForbiddenException); // even clearing one
    await expect(controller.createCopy('b1', { internalNote: 'x' } as never, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.updateCopy('b1', 'c1', { internalNote: 'x' } as never, user)).rejects.toBeInstanceOf(ForbiddenException);
    for (const fn of [books.create, books.update, books.createCopy, books.updateCopy]) expect(fn).not.toHaveBeenCalled();
  });

  it('writes without a note still work for a caller who cannot see notes', async () => {
    await controller.create({ title: 'T', copy: {} } as never, user);
    await controller.update('b1', { title: 'New' } as never, user);
    await controller.createCopy('b1', { location: 'A' } as never, user);
    await controller.updateCopy('b1', 'c1', { location: 'B' } as never, user);
    expect(books.create).toHaveBeenCalled();
    expect(books.updateCopy).toHaveBeenCalled();
  });

  it('writes: a caller with notes.view may set a note', async () => {
    codes.add('library_catalog.notes.view');
    await controller.update('b1', { internalNote: 'needs rebinding' } as never, user);
    expect(books.update).toHaveBeenCalledWith('b1', { internalNote: 'needs rebinding' });
  });
});
