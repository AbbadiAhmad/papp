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
    update: jest.Mock;
    delete: jest.Mock;
  };
  user: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
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
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn) => fn({ libraryCatalogBook: {}, libraryCatalogBookCopy: {} })),
    // LIBRARY_CATALOG-D22 — auto-generated `Bxxxxxx` copy codes, same
    // $queryRawUnsafe('SELECT nextval(...)') shape as library_circulation's
    // own FinesService.nextNumber(). Defaults to sequence value 1 so a test
    // not explicitly exercising this path still gets a deterministic code.
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
  };
}

function ratingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rating-1',
    bookId: 'book-1',
    userId: 'user-1',
    rating: 5,
    review: null,
    reviewStatus: 'approved',
    moderatedBy: null,
    moderatedAt: null,
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

    it('LIBRARY_CATALOG-D22: auto-generates a Bxxxxxx code for the initial copy when copy.qrCode is omitted', async () => {
      const dto = { title: 'Blank Code Book', copy: {} } as unknown as CreateBookDto;
      const bookCreated = bookRow({ id: 'book-3', title: 'Blank Code Book' });

      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookCreated) },
          libraryCatalogBookCopy: {
            create: jest.fn((arg: { data: Record<string, unknown> }) => {
              expect(arg.data.qrCode).toBe('B000099');
              return copyRow({ qrCode: 'B000099', bookId: 'book-3' });
            }),
          },
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: BigInt(99) }]),
        };
        return fn(tx as never);
      });

      await service.create(dto);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('bug fix: an explicitly-submitted Bxxxxxx code (the accepted suggestion) still bumps the sequence so the NEXT peek is reevaluated', async () => {
      // Reproduces bug (1): the Add Book form pre-fills `copy.qrCode` with
      // `peekNextCopyCode()`'s suggestion, so an unedited accept submits it
      // as an explicit, non-blank string — the manually-typed branch must
      // still reconcile the sequence forward, not skip it.
      const dto = { title: 'Accepted Suggestion Book', copy: { qrCode: 'B000005' } } as unknown as CreateBookDto;
      const queryRawUnsafe = jest.fn().mockResolvedValue([{ last_value: BigInt(4) }]);
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookRow({ id: 'book-9' })) },
          libraryCatalogBookCopy: { create: jest.fn().mockResolvedValue(copyRow({ qrCode: 'B000005', bookId: 'book-9' })) },
          $queryRawUnsafe: queryRawUnsafe,
        };
        return fn(tx as never);
      });

      await service.create(dto);

      expect(queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("setval('library_catalog_copy_code_seq'"),
        BigInt(5),
      );
    });

    it("bug fix: a manually-typed Bxxxxxx code AHEAD of the sequence (bug 2's \"concurrent code\") fast-forwards it so it won't be re-suggested", async () => {
      const dto = { title: 'Concurrent Code Book', copy: { qrCode: 'B000050' } } as unknown as CreateBookDto;
      const queryRawUnsafe = jest.fn().mockResolvedValue([{ last_value: BigInt(4) }]);
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookRow({ id: 'book-10' })) },
          libraryCatalogBookCopy: { create: jest.fn().mockResolvedValue(copyRow({ qrCode: 'B000050', bookId: 'book-10' })) },
          $queryRawUnsafe: queryRawUnsafe,
        };
        return fn(tx as never);
      });

      await service.create(dto);

      expect(queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("setval('library_catalog_copy_code_seq'"),
        BigInt(50),
      );
    });

    it('does not touch the sequence for a manually-typed code outside the Bxxxxxx format', async () => {
      const dto = { title: 'Legacy Code Book', copy: { qrCode: 'LEGACY-1' } } as unknown as CreateBookDto;
      const queryRawUnsafe = jest.fn();
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          libraryCatalogBook: { create: jest.fn().mockResolvedValue(bookRow({ id: 'book-11' })) },
          libraryCatalogBookCopy: { create: jest.fn().mockResolvedValue(copyRow({ qrCode: 'LEGACY-1', bookId: 'book-11' })) },
          $queryRawUnsafe: queryRawUnsafe,
        };
        return fn(tx as never);
      });

      await service.create(dto);

      expect(queryRawUnsafe).not.toHaveBeenCalled();
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

      it('LIBRARY_CATALOG-D22: auto-generates a sequence-backed Bxxxxxx code when qrCode is omitted, never checking for a duplicate of an empty string', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.$queryRawUnsafe.mockResolvedValue([{ nextval: BigInt(42) }]);
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ qrCode: 'B000042' }));

        await service.createCopy('book-1', {} as CreateBookCopyDto);

        expect(prisma.libraryCatalogBookCopy.findUnique).not.toHaveBeenCalled();
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT nextval('library_catalog_copy_code_seq') AS nextval");
        expect(prisma.libraryCatalogBookCopy.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ qrCode: 'B000042' }) }),
        );
      });

      it('LIBRARY_CATALOG-D22: a blank/whitespace-only qrCode is treated the same as omitted', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.$queryRawUnsafe.mockResolvedValue([{ nextval: BigInt(7) }]);
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ qrCode: 'B000007' }));

        await service.createCopy('book-1', { qrCode: '   ' } as CreateBookCopyDto);

        expect(prisma.libraryCatalogBookCopy.findUnique).not.toHaveBeenCalled();
        expect(prisma.libraryCatalogBookCopy.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ qrCode: 'B000007' }) }),
        );
      });

      it('bug fix: an explicitly-submitted Bxxxxxx code (the accepted suggestion) still bumps the sequence', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
        prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(4) }]);
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ qrCode: 'B000005' }));

        await service.createCopy('book-1', { qrCode: 'B000005' } as CreateBookCopyDto);

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
          expect.stringContaining("setval('library_catalog_copy_code_seq'"),
          BigInt(5),
        );
      });

      it("bug fix: a manually-typed Bxxxxxx code AHEAD of the sequence (bug 2's \"concurrent code\") fast-forwards it", async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
        prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(4) }]);
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ qrCode: 'B000050' }));

        await service.createCopy('book-1', { qrCode: 'B000050' } as CreateBookCopyDto);

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
          expect.stringContaining("setval('library_catalog_copy_code_seq'"),
          BigInt(50),
        );
      });

      it('does not touch the sequence for a manually-typed code outside the Bxxxxxx format', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookCopy.findUnique.mockResolvedValue(null);
        prisma.libraryCatalogBookCopy.create.mockResolvedValue(copyRow({ qrCode: 'LEGACY-1' }));

        await service.createCopy('book-1', { qrCode: 'LEGACY-1' } as CreateBookCopyDto);

        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
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

    describe('peekNextCopyCode (LIBRARY_CATALOG-D22 follow-up — "suggest the next code")', () => {
      it('formats last_value + 1 as Bxxxxxx when the sequence has already been consumed (is_called = true)', async () => {
        prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(6), is_called: true }]);

        const result = await service.peekNextCopyCode();

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT last_value, is_called FROM library_catalog_copy_code_seq');
        expect(result).toBe('B000007');
      });

      it('formats last_value itself (not +1) when the sequence has never been consumed (is_called = false)', async () => {
        prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(1), is_called: false }]);

        const result = await service.peekNextCopyCode();

        expect(result).toBe('B000001');
      });

      it('never calls nextval() — a peek must not consume the sequence', async () => {
        prisma.$queryRawUnsafe.mockResolvedValue([{ last_value: BigInt(3), is_called: true }]);

        await service.peekNextCopyCode();

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringContaining('nextval'));
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

  describe('listCopiesForPrint / exportCopiesForPrintWorkbook (LIBRARY_CATALOG-D22)', () => {
    it('filters by acquisitionDate within [from, to] inclusive and joins the book title', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { ...copyRow({ qrCode: 'B000001', location: 'Shelf A' }), book: { title: 'Kalila wa Dimna' } },
      ]);

      const result = await service.listCopiesForPrint({ from: '2026-09-01', to: '2026-09-30' });

      expect(prisma.libraryCatalogBookCopy.findMany).toHaveBeenCalledWith({
        where: { acquisitionDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } },
        orderBy: { acquisitionDate: 'asc' },
        include: { book: { select: { title: true } } },
      });
      expect(result).toEqual([
        { id: 'copy-1', qrCode: 'B000001', location: 'Shelf A', acquisitionDate: null, bookTitle: 'Kalila wa Dimna' },
      ]);
    });

    it('returns every copy (no acquisitionDate filter at all) when both from/to are omitted', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([]);

      await service.listCopiesForPrint({});

      expect(prisma.libraryCatalogBookCopy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('never exposes the book title as part of a sticker-printable field — only bookTitle, kept separate from qrCode/location', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { ...copyRow({ qrCode: 'B000002' }), book: { title: 'Another Title' } },
      ]);

      const [row] = await service.listCopiesForPrint({});

      expect(row.qrCode).toBe('B000002');
      expect(row.bookTitle).toBe('Another Title');
      expect(row.qrCode).not.toContain('Another Title');
    });

    it('exportCopiesForPrintWorkbook produces an xlsx buffer covering the same filtered rows', async () => {
      prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([
        { ...copyRow({ qrCode: 'B000003', location: 'Shelf B' }), book: { title: 'Exported Title' } },
      ]);

      const buffer = await service.exportCopiesForPrintWorkbook({});

      expect(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
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
      expect(result.myRating).toEqual({ rating: 5, review: 'Loved it', reviewStatus: 'approved' });
    });

    it('LIBRARY_CATALOG-D21: hides another reader\'s non-approved review from the public list, but always shows the caller their own', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue({ ...bookRow(), copies: [] });
      prisma.libraryCatalogBookRating.findMany.mockResolvedValue([
        ratingRow({ id: 'r1', userId: 'user-1', rating: 5, review: 'My own pending review', reviewStatus: 'pending' }),
        ratingRow({ id: 'r2', userId: 'user-2', rating: 4, review: 'Someone else, still pending', reviewStatus: 'pending' }),
        ratingRow({ id: 'r3', userId: 'user-3', rating: 2, review: 'Someone else, rejected', reviewStatus: 'rejected' }),
        ratingRow({ id: 'r4', userId: 'user-4', rating: 3, review: 'Someone else, approved', reviewStatus: 'approved' }),
      ]);

      const result = await service.findById('book-1', 'user-1');

      // The numeric average/count include EVERY rating regardless of review moderation.
      expect(result.ratingsCount).toBe(4);
      const visibleIds = result.ratings.map((r) => r.id);
      expect(visibleIds).toContain('r1'); // the caller's own — always visible to them
      expect(visibleIds).toContain('r4'); // approved — visible to everyone
      expect(visibleIds).not.toContain('r2'); // someone else's pending review — hidden
      expect(visibleIds).not.toContain('r3'); // someone else's rejected review — hidden
      expect(result.myRating).toEqual({ rating: 5, review: 'My own pending review', reviewStatus: 'pending' });
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
      prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(null);
      prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

      await service.rateBook('book-1', 'user-1', { rating: 5, review: 'Great read' });

      expect(prisma.libraryCatalogBookRating.upsert).toHaveBeenCalledWith({
        where: { bookId_userId: { bookId: 'book-1', userId: 'user-1' } },
        create: { bookId: 'book-1', userId: 'user-1', rating: 5, review: 'Great read', reviewStatus: 'pending' },
        update: { rating: 5, review: 'Great read', reviewStatus: 'pending', moderatedBy: null, moderatedAt: null },
      });
    });

    it('throws NotFoundException for an unknown book, never touching the rating table', async () => {
      prisma.libraryCatalogBook.findUnique.mockResolvedValue(null);

      await expect(service.rateBook('missing', 'user-1', { rating: 4 })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.libraryCatalogBookRating.upsert).not.toHaveBeenCalled();
    });

    describe('LIBRARY_CATALOG-D21: review moderation reset rules', () => {
      it('a rating with no review text needs no moderation — reviewStatus is "approved"', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(null);
        prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

        await service.rateBook('book-1', 'user-1', { rating: 4 });

        expect(prisma.libraryCatalogBookRating.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ reviewStatus: 'approved' }) }),
        );
      });

      it('editing only the star rating (review text unchanged) preserves the existing reviewStatus and moderation record', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(
          ratingRow({ review: 'Same text', reviewStatus: 'rejected', moderatedBy: 'mod-1' }),
        );
        prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

        await service.rateBook('book-1', 'user-1', { rating: 2, review: 'Same text' });

        const call = (prisma.libraryCatalogBookRating.upsert as jest.Mock).mock.calls[0][0];
        expect(call.update.reviewStatus).toBe('rejected');
        expect(call.update).not.toHaveProperty('moderatedBy');
        expect(call.update).not.toHaveProperty('moderatedAt');
      });

      it('editing the review text resets reviewStatus to "pending" and clears any prior moderation decision', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(
          ratingRow({ review: 'Old text', reviewStatus: 'approved', moderatedBy: 'mod-1', moderatedAt: new Date() }),
        );
        prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

        await service.rateBook('book-1', 'user-1', { rating: 5, review: 'New, edited text' });

        expect(prisma.libraryCatalogBookRating.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ review: 'New, edited text', reviewStatus: 'pending', moderatedBy: null, moderatedAt: null }),
          }),
        );
      });

      it('removing the review text (rating only) sets reviewStatus back to "approved"', async () => {
        prisma.libraryCatalogBook.findUnique.mockResolvedValue({ id: 'book-1' });
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(ratingRow({ review: 'Something', reviewStatus: 'pending' }));
        prisma.libraryCatalogBookRating.upsert.mockResolvedValue(ratingRow());

        await service.rateBook('book-1', 'user-1', { rating: 3 });

        expect(prisma.libraryCatalogBookRating.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ update: expect.objectContaining({ review: null, reviewStatus: 'approved' }) }),
        );
      });
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

  describe('review moderation queue (LIBRARY_CATALOG-D21)', () => {
    describe('listPendingReviews', () => {
      it('returns [] without any further queries when nothing is pending', async () => {
        prisma.libraryCatalogBookRating.findMany.mockResolvedValue([]);

        const result = await service.listPendingReviews();

        expect(result).toEqual([]);
        expect(prisma.libraryCatalogBook.findMany).not.toHaveBeenCalled();
      });

      it('joins book titles and rater names onto each pending review', async () => {
        prisma.libraryCatalogBookRating.findMany.mockResolvedValue([
          ratingRow({ id: 'r1', bookId: 'book-1', userId: 'user-1', review: 'Needs a look', reviewStatus: 'pending' }),
        ]);
        prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'book-1', title: 'Kalila wa Dimna' }]);
        prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Sara' }]);

        const result = await service.listPendingReviews();

        expect(prisma.libraryCatalogBookRating.findMany).toHaveBeenCalledWith({
          where: { reviewStatus: 'pending' },
          orderBy: { updatedAt: 'asc' },
        });
        expect(result).toEqual([
          expect.objectContaining({ id: 'r1', bookTitle: 'Kalila wa Dimna', userName: 'Sara', review: 'Needs a look' }),
        ]);
      });
    });

    describe('approveReview / rejectReview', () => {
      it('approveReview sets reviewStatus=approved and records the moderator + timestamp', async () => {
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(ratingRow({ id: 'r1', reviewStatus: 'pending' }));
        prisma.libraryCatalogBookRating.update.mockResolvedValue(ratingRow({ id: 'r1', reviewStatus: 'approved' }));

        await service.approveReview('r1', 'mod-1');

        expect(prisma.libraryCatalogBookRating.update).toHaveBeenCalledWith({
          where: { id: 'r1' },
          data: { reviewStatus: 'approved', moderatedBy: 'mod-1', moderatedAt: expect.any(Date) },
        });
      });

      it('rejectReview sets reviewStatus=rejected and records the moderator + timestamp', async () => {
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(ratingRow({ id: 'r1', reviewStatus: 'pending' }));
        prisma.libraryCatalogBookRating.update.mockResolvedValue(ratingRow({ id: 'r1', reviewStatus: 'rejected' }));

        await service.rejectReview('r1', 'mod-1');

        expect(prisma.libraryCatalogBookRating.update).toHaveBeenCalledWith({
          where: { id: 'r1' },
          data: { reviewStatus: 'rejected', moderatedBy: 'mod-1', moderatedAt: expect.any(Date) },
        });
      });

      it('throws NotFoundException for an unknown rating id, never calling update', async () => {
        prisma.libraryCatalogBookRating.findUnique.mockResolvedValue(null);

        await expect(service.approveReview('missing', 'mod-1')).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.libraryCatalogBookRating.update).not.toHaveBeenCalled();
      });
    });
  });
});
