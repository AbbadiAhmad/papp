import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LibraryCatalogBookCopyStatus, Prisma } from '@prisma/client';
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
    delete: jest.Mock;
  };
  libraryCatalogBookRating: {
    groupBy: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };
  user: {
    findMany: jest.Mock;
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
      delete: jest.fn(),
    },
    libraryCatalogBookRating: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn) => fn({ libraryCatalogBook: {}, libraryCatalogBookCopy: {} })),
  };
}

function ratingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rating-1',
    bookId: 'book-1',
    userId: 'user-1',
    rating: 5,
    review: null,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
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
            copyRow({ status: LibraryCatalogBookCopyStatus.available }),
            copyRow({ status: LibraryCatalogBookCopyStatus.available }),
            copyRow({ status: LibraryCatalogBookCopyStatus.borrowed }),
          ],
        },
      ]);

      const result = await service.list({});

      expect(prisma.libraryCatalogBook.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { title: 'asc' },
        include: {
          _count: { select: { copies: true } },
          copies: true,
        },
      });
      expect(result).toEqual([
        {
          ...bookRow(),
          totalCopies: 3,
          availableCopies: 2,
          averageRating: null,
          ratingsCount: 0,
          _count: undefined,
          copies: undefined,
        },
      ]);
    });

    it('merges the ratings aggregate (LIBRARY_CATALOG-D20) into each book, keyed by bookId', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([
        { ...bookRow({ id: 'book-1' }), _count: { copies: 0 }, copies: [] },
        { ...bookRow({ id: 'book-2' }), _count: { copies: 0 }, copies: [] },
      ]);
      prisma.libraryCatalogBookRating.groupBy.mockResolvedValue([
        { bookId: 'book-1', _avg: { rating: 4.5 }, _count: { rating: 2 } },
      ]);

      const result = await service.list({});

      expect(prisma.libraryCatalogBookRating.groupBy).toHaveBeenCalledWith({
        by: ['bookId'],
        where: { bookId: { in: ['book-1', 'book-2'] } },
        _avg: { rating: true },
        _count: { rating: true },
      });
      expect(result[0]).toMatchObject({ averageRating: 4.5, ratingsCount: 2 });
      expect(result[1]).toMatchObject({ averageRating: null, ratingsCount: 0 });
    });

    it('filters by search (case-insensitive contains on title) and category when supplied', async () => {
      prisma.libraryCatalogBook.findMany.mockResolvedValue([]);

      await service.list({ search: 'kalila', category: 'fiction' });

      expect(prisma.libraryCatalogBook.findMany).toHaveBeenCalledWith({
        where: { title: { contains: 'kalila', mode: 'insensitive' }, category: 'fiction' },
        orderBy: { title: 'asc' },
        include: {
          _count: { select: { copies: true } },
          copies: true,
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
      it('updates a copy with the provided DTO', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        const dto: UpdateBookCopyDto = { status: LibraryCatalogBookCopyStatus.borrowed };
        prisma.libraryCatalogBookCopy.update.mockResolvedValue(copyRow({ status: LibraryCatalogBookCopyStatus.borrowed }));

        const result = await service.updateCopy('book-1', 'copy-1', dto);

        const callData = (prisma.libraryCatalogBookCopy.update as jest.Mock).mock.calls[0][0];
        expect(callData.where).toEqual({ id: 'copy-1' });
        expect(callData.data.status).toBe(LibraryCatalogBookCopyStatus.borrowed);
        expect(callData.data.history).toEqual(expect.any(Array));
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

    describe('removeCopy — LIBRARY_CATALOG-D19 (lets remove() ever reach zero copies)', () => {
      it('deletes the copy once found', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        prisma.libraryCatalogBookCopy.delete.mockResolvedValue(copyRow());

        await expect(service.removeCopy('book-1', 'copy-1')).resolves.toBeUndefined();
        expect(prisma.libraryCatalogBookCopy.delete).toHaveBeenCalledWith({ where: { id: 'copy-1' } });
      });

      it('throws NotFoundException for a copy that does not belong to the given book, never touching delete', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow({ bookId: 'other-book' }));

        await expect(service.removeCopy('book-1', 'copy-1')).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.libraryCatalogBookCopy.delete).not.toHaveBeenCalled();
      });

      it('converts a Postgres FK violation (borrowing history exists) into a ConflictException', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        prisma.libraryCatalogBookCopy.delete.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: '6.0.0', meta: { field_name: 'book_copy_id' } }),
        );

        await expect(service.removeCopy('book-1', 'copy-1')).rejects.toBeInstanceOf(ConflictException);
      });

      it('re-throws any other unexpected error unchanged', async () => {
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(copyRow());
        const unexpected = new Error('connection reset');
        prisma.libraryCatalogBookCopy.delete.mockRejectedValue(unexpected);

        await expect(service.removeCopy('book-1', 'copy-1')).rejects.toBe(unexpected);
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

  describe('findById — ratings (LIBRARY_CATALOG-D20)', () => {
    it('returns null averageRating/zero ratingsCount/no myRating for a book nobody has rated', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), copies: [] });
      prisma.libraryCatalogBookRating.findMany.mockResolvedValue([]);

      const result = await service.findById('book-1', 'user-1');

      expect(result.averageRating).toBeNull();
      expect(result.ratingsCount).toBe(0);
      expect(result.ratings).toEqual([]);
      expect(result.myRating).toBeNull();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('computes the average, joins rater names, and surfaces the caller\'s own rating separately', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), copies: [] });
      prisma.libraryCatalogBookRating.findMany.mockResolvedValue([
        ratingRow({ id: 'r1', userId: 'user-1', rating: 5, review: 'Loved it' }),
        ratingRow({ id: 'r2', userId: 'user-2', rating: 3, review: null }),
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'Sara' },
        { id: 'user-2', name: 'Omar' },
      ]);

      const result = await service.findById('book-1', 'user-1');

      expect(result.averageRating).toBe(4);
      expect(result.ratingsCount).toBe(2);
      expect(result.ratings).toEqual([
        expect.objectContaining({ id: 'r1', userName: 'Sara', rating: 5, review: 'Loved it' }),
        expect.objectContaining({ id: 'r2', userName: 'Omar', rating: 3, review: null }),
      ]);
      expect(result.myRating).toEqual({ rating: 5, review: 'Loved it' });
    });

    it('returns myRating: null when currentUserId is omitted (e.g. a system/anonymous caller)', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), copies: [] });
      prisma.libraryCatalogBookRating.findMany.mockResolvedValue([ratingRow({ userId: 'user-1' })]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Sara' }]);

      const result = await service.findById('book-1');

      expect(result.myRating).toBeNull();
    });

    it('throws NotFoundException for an unknown book before ever querying ratings', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBookRating.findMany).not.toHaveBeenCalled();
    });
  });

  describe('rateBook — one row per (book, user), editable', () => {
    it('upserts keyed on the composite (bookId, userId) unique index', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
      prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

      await service.rateBook('book-1', 'user-1', { rating: 5, review: 'Great read' });

      expect(prisma.libraryCatalogBookRating.upsert).toHaveBeenCalledWith({
        where: { bookId_userId: { bookId: 'book-1', userId: 'user-1' } },
        create: { bookId: 'book-1', userId: 'user-1', rating: 5, review: 'Great read' },
        update: { rating: 5, review: 'Great read' },
      });
    });

    it('throws NotFoundException for an unknown book, never touching the rating table', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.rateBook('missing', 'user-1', { rating: 4 })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBookRating.upsert).not.toHaveBeenCalled();
    });
  });

  describe('removeRating', () => {
    it('deletes the caller\'s own rating row', async () => {
      prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(ratingRow({ id: 'rating-9' }));
      prisma.libraryCatalogBookRating.delete.mockResolvedValue(ratingRow({ id: 'rating-9' }));

      await service.removeRating('book-1', 'user-1');

      expect(prisma.libraryCatalogBookRating.findUnique).toHaveBeenCalledWith({
        where: { bookId_userId: { bookId: 'book-1', userId: 'user-1' } },
      });
      expect(prisma.libraryCatalogBookRating.delete).toHaveBeenCalledWith({ where: { id: 'rating-9' } });
    });

    it('throws NotFoundException when the caller never rated this book, never calling delete', async () => {
      prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(null);

      await expect(service.removeRating('book-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBookRating.delete).not.toHaveBeenCalled();
    });
  });
});
