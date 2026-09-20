import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { BooksService } from '../../backend/books.service';
import type { CreateBookCopyDto } from '../../backend/dto/create-book-copy.dto';
import type { CreateBookDto } from '../../backend/dto/create-book.dto';
import type { UpdateBookCopyDto } from '../../backend/dto/update-book-copy.dto';
import type { UpdateBookDto } from '../../backend/dto/update-book.dto';

interface MockPrisma {
  libraryCatalogBook: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  libraryCatalogBookCopy: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  return {
    libraryCatalogBook: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    libraryCatalogBookCopy: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn({ libraryCatalogBook: {}, libraryCatalogBookCopy: {} })),
  };
}

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'book-1',
    title: 'Kalila wa Dimna',
    author: null,
    publisher: null,
    category: null,
    readingLevel: null,
    language: null,
    description: null,
    coverImage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function copyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'copy-1',
    bookId: 'book-1',
    qrCode: 'QR-1',
    status: LibraryCatalogBookCopyStatus.available,
    condition: null,
    location: null,
    acquisitionDate: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * BooksService constructs its own `PrismaClient` instance as a private class
 * field (no constructor DI at all — see books.service.ts's own docblock and
 * DECISIONS.md D57 for why: this module owns its Prisma lifecycle end to
 * end, `@prisma/client` resolved as a real hoisted npm package rather than a
 * fragile repo-relative import of apps/api's PrismaService). That means
 * there is no constructor seam to hand a mock through the way
 * apps/api/test/** mocks PrismaService (e.g. roles.service.spec.ts's
 * `new RolesService(prisma as never)`).
 *
 * `new PrismaClient()` itself is inert — it only touches a real database once
 * `$connect()` is called (BooksService.onModuleInit, never invoked here), so
 * constructing the real service is safe. The private `prisma` field is then
 * swapped for a hand-rolled jest.fn() mock, using the same reflection idiom
 * apps/api/test/** already uses to reach other private members (see
 * module-registry.service.spec.ts's `service as unknown as {...}` casts).
 */
function buildService(prisma: MockPrisma): BooksService {
  const service = new BooksService();
  (service as unknown as { prisma: MockPrisma }).prisma = prisma;
  return service;
}

describe('BooksService', () => {
  let prisma: MockPrisma;
  let service: BooksService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  describe('list', () => {
    it('maps _count.copies to totalCopies and filters availableCopies', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([
        {
          ...bookRow(),
          _count: { copies: 3 },
          copies: [
            { status: LibraryCatalogBookCopyStatus.available },
            { status: LibraryCatalogBookCopyStatus.available },
            { status: LibraryCatalogBookCopyStatus.borrowed },
          ],
        },
      ]);

      const result = await service.list({});

      expect(prisma.libraryCatalogBook.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { title: 'asc' },
        include: {
          _count: { select: { copies: true } },
          copies: { select: { status: true } },
        },
      });
      expect(result).toEqual([
        {
          ...bookRow(),
          totalCopies: 3,
          availableCopies: 2,
          _count: undefined,
          copies: undefined,
        },
      ]);
    });

    it('filters by search (case-insensitive contains on title) and category when supplied', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([]);

      await service.list({ search: 'kalila', category: 'fiction' });

      expect(prisma.libraryCatalogBook.findMany).toHaveBeenCalledWith({
        where: { title: { contains: 'kalila', mode: 'insensitive' }, category: 'fiction' },
        orderBy: { title: 'asc' },
        include: {
          _count: { select: { copies: true } },
          copies: { select: { status: true } },
        },
      });
    });
  });

  describe('create — Phase A: combined book + copy', () => {
    it('creates a book and its initial copy in a transaction', async () => {
      const dto = {
        title: 'New Title',
        author: 'Ahmed',
        copy: {
          qrCode: 'BOOK-001',
          condition: 'good',
          location: 'Shelf A',
          acquisitionDate: '2026-09-20',
        },
      } as unknown as CreateBookDto;

      const bookCreated = bookRow({ id: 'book-new', title: 'New Title', author: 'Ahmed' });
      const copyCreated = copyRow({ qrCode: 'BOOK-001', bookId: 'book-new', condition: 'good', location: 'Shelf A' });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookCreated) },
          libraryCatalogBookCopy: { create: jest.fn().mockResolvedValue(copyCreated) },
        };
        return fn(tx as never);
      });

      const result = await service.create(dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual(bookCreated);
    });

    it('defaults copy.status to "available" when omitted', async () => {
      const dto = {
        title: 'Another Book',
        copy: {
          qrCode: 'BOOK-002',
        },
      } as unknown as CreateBookDto;

      const bookCreated = bookRow({ id: 'book-2', title: 'Another Book' });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookCreated) },
          libraryCatalogBookCopy: { create: jest.fn((arg: Record<string, unknown>) => {
            expect(arg.data.status).toBe('available');
            return copyRow({ qrCode: 'BOOK-002', bookId: 'book-2' });
          }) },
        };
        return fn(tx as never);
      });

      await service.create(dto);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('returns the updated row', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
      const dto: UpdateBookDto = { title: 'Updated Title' };
      prisma.libraryCatalogBook.update.mockResolvedValue(bookRow({ title: 'Updated Title' }));

      const result = await service.update('book-1', dto);

      expect(prisma.libraryCatalogBook.update).toHaveBeenCalledWith({ where: { id: 'book-1' }, data: dto });
      expect(result.title).toBe('Updated Title');
    });

    it('throws NotFoundException before writing when the book does not exist', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBook.update).not.toHaveBeenCalled();
    });
  });

  describe('remove — the never-lose-data-silently rule', () => {
    it('rejects with ConflictException and never calls delete when the book still has copies', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), _count: { copies: 2 } });

      await expect(service.remove('book-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.libraryCatalogBook.delete).not.toHaveBeenCalled();
    });

    it('deletes the book once it has zero copies', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), _count: { copies: 0 } });
      prisma.libraryCatalogBook.delete.mockResolvedValue(bookRow());

      await expect(service.remove('book-1')).resolves.toBeUndefined();
      expect(prisma.libraryCatalogBook.delete).toHaveBeenCalledWith({ where: { id: 'book-1' } });
    });

    it('throws NotFoundException for an unknown book id, never touching delete', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBook.delete).not.toHaveBeenCalled();
    });
  });

  describe('copy management', () => {
    describe('createCopy', () => {
      it('defaults status to available when the dto omits it', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
        const dto = { qrCode: 'QR-1' } as CreateBookCopyDto;
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow());

        await service.createCopy('book-1', dto);

        expect(prisma.libraryCatalogBookCopy.create).toHaveBeenCalledWith({
          data: {
            bookId: 'book-1',
            qrCode: 'QR-1',
            status: LibraryCatalogBookCopyStatus.available,
            condition: undefined,
            location: undefined,
            acquisitionDate: undefined,
          },
        });
      });

      it('passes through an explicit status untouched', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
        const dto = { qrCode: 'QR-2', status: LibraryCatalogBookCopyStatus.reserved } as CreateBookCopyDto;
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ status: LibraryCatalogBookCopyStatus.reserved }));

        await service.createCopy('book-1', dto);

        expect(prisma.libraryCatalogBookCopy.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: LibraryCatalogBookCopyStatus.reserved }) }),
        );
      });

      it('rejects a duplicate QR code with ConflictException, never calling create', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());

        await expect(service.createCopy('book-1', { qrCode: 'QR-1' } as CreateBookCopyDto)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(prisma.libraryCatalogBookCopy.create).not.toHaveBeenCalled();
      });

      it('throws NotFoundException for an unknown book before touching copies at all', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

        await expect(service.createCopy('missing', { qrCode: 'QR-1' } as CreateBookCopyDto)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(prisma.libraryCatalogBookCopy.findUnique).not.toHaveBeenCalled();
        expect(prisma.libraryCatalogBookCopy.create).not.toHaveBeenCalled();
      });
    });

    describe('listCopies', () => {
      it('lists a book copies ordered by createdAt asc', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([copyRow()]);

        const result = await service.listCopies('book-1');

        expect(prisma.libraryCatalogBookCopy.findMany).toHaveBeenCalledWith({
          where: { bookId: 'book-1' },
          orderBy: { createdAt: 'asc' },
        });
        expect(result).toEqual([copyRow()]);
      });

      it('throws NotFoundException for an unknown book before listing its copies', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

        await expect(service.listCopies('missing')).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.libraryCatalogBookCopy.findMany).not.toHaveBeenCalled();
      });
    });

    describe('updateCopy', () => {
      it('updates a copy status using the real migration enum values', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        const dto: UpdateBookCopyDto = { status: LibraryCatalogBookCopyStatus.borrowed };
        prisma.libraryCatalogBookCopy.update.mockResolvedValue(copyRow({ status: LibraryCatalogBookCopyStatus.borrowed }));

        const result = await service.updateCopy('book-1', 'copy-1', dto);

        const callData = (prisma.libraryCatalogBookCopy.update as jest.Mock).mock.calls[0][0];
        expect(callData.where).toEqual({ id: 'copy-1' });
        expect(callData.data.status).toBe(LibraryCatalogBookCopyStatus.borrowed);
        expect(callData.data.history).toBeDefined();
        expect(result.status).toBe(LibraryCatalogBookCopyStatus.borrowed);
      });

      it.each([
        LibraryCatalogBookCopyStatus.lost,
        LibraryCatalogBookCopyStatus.damaged,
        LibraryCatalogBookCopyStatus.maintenance,
      ])('accepts the real enum value %s', async (status) => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        prisma.libraryCatalogBookCopy.update.mockResolvedValue(copyRow({ status }));

        const result = await service.updateCopy('book-1', 'copy-1', { status });

        expect(result.status).toBe(status);
      });

      it('throws NotFoundException when the copy does not belong to the given book', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ bookId: 'some-other-book' }));

        await expect(service.updateCopy('book-1', 'copy-1', {})).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.libraryCatalogBookCopy.update).not.toHaveBeenCalled();
      });

      it('throws NotFoundException when the copy does not exist at all', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);

        await expect(service.updateCopy('book-1', 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.libraryCatalogBookCopy.update).not.toHaveBeenCalled();
      });

      it('Feature 2.1: tracks status/condition/location changes in history', async () => {
        const existingHistory = [
          { timestamp: '2026-09-10T10:00:00Z', changes: { status: { before: 'available', after: 'borrowed' } } },
        ];
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(
          copyRow({ status: LibraryCatalogBookCopyStatus.borrowed, history: existingHistory }),
        );
        prisma.libraryCatalogBookCopy.update.mockResolvedValue(
          copyRow({
            status: LibraryCatalogBookCopyStatus.damaged,
            history: [
              ...existingHistory,
              { timestamp: expect.any(String), changes: { status: { before: 'borrowed', after: 'damaged' } } },
            ],
          }),
        );

        const dto: UpdateBookCopyDto = { status: LibraryCatalogBookCopyStatus.damaged };
        await service.updateCopy('book-1', 'copy-1', dto);

        const callData = (prisma.libraryCatalogBookCopy.update as jest.Mock).mock.calls[0][0];
        const history = callData.data.history as Record<string, unknown>[];
        expect(history).toHaveLength(2);
        expect(history[1]).toHaveProperty('changes.status');
      });
    });

    describe('getCopyHistory', () => {
      it('returns up to limit history entries for a copy, newest last', async () => {
        const history = [
          { timestamp: '2026-09-10T10:00:00Z', changes: { status: { before: 'available', after: 'borrowed' } } },
          { timestamp: '2026-09-15T14:30:00Z', changes: { status: { before: 'borrowed', after: 'available' } } },
        ];
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ history }));

        const result = await service.getCopyHistory('copy-1', 10);

        expect(result).toEqual(history);
      });

      it('respects the limit parameter, returning only the most recent entries', async () => {
        const history = [
          { timestamp: '2026-09-01T10:00:00Z', changes: { condition: { before: 'good', after: 'fair' } } },
          { timestamp: '2026-09-10T10:00:00Z', changes: { status: { before: 'available', after: 'borrowed' } } },
          { timestamp: '2026-09-15T14:30:00Z', changes: { status: { before: 'borrowed', after: 'available' } } },
        ];
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ history }));

        const result = await service.getCopyHistory('copy-1', 2);

        expect(result).toEqual(history.slice(-2));
      });

      it('returns empty array for a copy with no history', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ history: [] }));

        const result = await service.getCopyHistory('copy-1');

        expect(result).toEqual([]);
      });

      it('throws NotFoundException for a nonexistent copy', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);

        await expect(service.getCopyHistory('missing')).rejects.toBeInstanceOf(NotFoundException);
      });
    });
  });

  describe('getAvailability (backing the public route)', () => {
    it('returns {bookId, title, totalCopies, availableCopies}, counting only available-status copies', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({
        ...bookRow({ id: 'book-1', title: 'Kalila wa Dimna' }),
        copies: [
          copyRow({ status: LibraryCatalogBookCopyStatus.available }),
          copyRow({ status: LibraryCatalogBookCopyStatus.borrowed }),
          copyRow({ status: LibraryCatalogBookCopyStatus.available }),
        ],
      });

      const result = await service.getAvailability('book-1');

      expect(result).toEqual({ bookId: 'book-1', title: 'Kalila wa Dimna', totalCopies: 3, availableCopies: 2 });
    });

    it('returns zero/zero for a book with no copies at all', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({
        ...bookRow({ id: 'book-2', title: 'No Copies Yet' }),
        copies: [],
      });

      const result = await service.getAvailability('book-2');

      expect(result).toEqual({ bookId: 'book-2', title: 'No Copies Yet', totalCopies: 0, availableCopies: 0 });
    });

    it('throws NotFoundException — never a permission-flavored error — for an unknown book id', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.getAvailability('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
