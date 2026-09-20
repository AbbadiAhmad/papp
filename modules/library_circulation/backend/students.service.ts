import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const READER_ROLE_CODE = 'reader';
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface CreatedStudent {
  id: string;
  userId: string;
  code: string;
  className: string | null;
  academicYearId: string | null;
  name: string;
  email: string;
  /** Returned ONCE, at creation time only — never stored in the clear, never re-returned. */
  temporaryPassword: string;
}

/**
 * A "student" (§2) is a real, login-capable platform User with the `reader`
 * role (root D41) — this service creates BOTH the user account and the
 * library-specific profile row in one transaction (the librarian's actual
 * workflow), reusing the same argon2id hashing (root ASSUMPTIONS.md A11)
 * every other password in this platform uses. No password is ever typed by
 * the librarian: a random one is generated, hashed, and returned exactly
 * once in the create response with `mustChangePassword: true` set — same
 * "admin sets an initial credential, the real owner picks their own next
 * login" pattern core's own admin-created-user flow already uses.
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other module) —
 * `User`/`Role`/`UserRole` are part of the one shared generated client even
 * though they're core tables, so no cross-module service import is needed
 * for this.
 */
@Injectable()
export class StudentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StudentsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('library_circulation (students) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list() {
    return this.prisma.libraryStudent.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Fines page's reader picker (searchable, max 5 shown) and the Scan page's
   * search-by-name alternative to a code scan. Matches on the student's own
   * `code` OR the linked `User.name` — `libraryStudent` doesn't store name
   * itself (D41: name lives on the platform User), so name matching needs a
   * User lookup first, then a code-based `IN` query joins the results back.
   */
  async search(query: string, limit = 5) {
    const q = query.trim();
    if (!q) return [];

    const [byCode, matchingUsers] = await Promise.all([
      this.prisma.libraryStudent.findMany({
        where: { code: { contains: q, mode: 'insensitive' } },
        take: limit,
      }),
      this.prisma.user.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: limit,
      }),
    ]);

    const byCodeIds = new Set(byCode.map((s) => s.id));
    const byNameStudents = matchingUsers.length
      ? await this.prisma.libraryStudent.findMany({
          where: { userId: { in: matchingUsers.map((u) => u.id) } },
        })
      : [];

    const userNameById = new Map(matchingUsers.map((u) => [u.id, u.name]));
    const merged = [
      ...byCode.map((s) => ({ ...s, name: null as string | null })),
      ...byNameStudents
        .filter((s) => !byCodeIds.has(s.id))
        .map((s) => ({ ...s, name: userNameById.get(s.userId) ?? null })),
    ];

    // byCode entries don't carry a resolved name yet — fill in for the ones we can, cheaply.
    if (merged.some((s) => s.name === null)) {
      const remainingUserIds = merged.filter((s) => s.name === null).map((s) => s.userId);
      const users = remainingUserIds.length
        ? await this.prisma.user.findMany({ where: { id: { in: remainingUserIds } }, select: { id: true, name: true } })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      for (const s of merged) {
        if (s.name === null) s.name = nameById.get(s.userId) ?? null;
      }
    }

    return merged.slice(0, limit);
  }

  async count(): Promise<number> {
    return this.prisma.libraryStudent.count();
  }

  async findById(id: string) {
    const student = await this.getOrThrow(id);
    const [user, activeBorrowingsRaw, openFines, allFines] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: student.userId }, select: { name: true, email: true, isActive: true } }),
      this.prisma.libraryBorrowing.findMany({
        where: { studentId: id, status: { in: ['active', 'overdue'] } },
        orderBy: { borrowedAt: 'desc' },
      }),
      this.prisma.libraryFine.findMany({
        where: { studentId: id, status: { in: ['unpaid', 'partially_paid'] } },
        orderBy: { createdAt: 'desc' },
      }),
      // §3.2's "total fines (paid + unpaid)" summary needs both buckets,
      // not just the open ones openFines already covers.
      this.prisma.libraryFine.findMany({ where: { studentId: id }, select: { status: true, amount: true, amountPaid: true } }),
    ]);

    const unpaidFinesTotal = allFines
      .filter((f) => f.status === 'unpaid' || f.status === 'partially_paid')
      .reduce((sum, f) => sum + Number(f.amount) - Number(f.amountPaid), 0);
    const paidFinesTotal = allFines.reduce((sum, f) => sum + Number(f.amountPaid), 0);

    const activeBorrowings = await this.enrichBorrowingsWithBookInfo(activeBorrowingsRaw);

    return {
      ...student,
      name: user?.name ?? null,
      email: user?.email ?? null,
      isActive: user?.isActive ?? true,
      activeBorrowingsCount: activeBorrowings.length,
      unpaidFinesTotal,
      paidFinesTotal,
      activeBorrowings,
      openFines,
    };
  }

  /** Shared by findById()'s activeBorrowings and getReadingHistory() — both show the SAME "which book" gap otherwise (bookCopyId is the only thing libraryBorrowing itself stores). */
  private async enrichBorrowingsWithBookInfo<T extends { bookCopyId: string }>(
    borrowings: T[],
  ): Promise<(T & { qrCode: string | null; bookTitle: string | null; readingLevel: string | null })[]> {
    if (borrowings.length === 0) return [];
    const copyIds = [...new Set(borrowings.map((b) => b.bookCopyId))];
    const copies = await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } } });
    const copyById = new Map(copies.map((c) => [c.id, c]));
    const bookIds = [...new Set(copies.map((c) => c.bookId))];
    const books = bookIds.length ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } } }) : [];
    const bookById = new Map(books.map((b) => [b.id, b]));

    return borrowings.map((b) => {
      const copy = copyById.get(b.bookCopyId);
      const book = copy ? bookById.get(copy.bookId) : undefined;
      return {
        ...b,
        qrCode: copy?.qrCode ?? null,
        bookTitle: book?.title ?? null,
        readingLevel: book?.readingLevel ?? null,
      };
    });
  }

  /**
   * §3.2 "Reading History" tab — every borrowing ever, not just the active
   * ones findById() already returns. Never deleted (§10's "reading passport"
   * rule — see this module's own DOCUMENTATION.md). Enriched with the book's
   * title/reading level/qrCode: `libraryBorrowing` only stores `bookCopyId`,
   * so the raw rows alone would show nothing a librarian could recognize.
   */
  async getReadingHistory(id: string) {
    await this.getOrThrow(id);
    const borrowings = await this.prisma.libraryBorrowing.findMany({
      where: { studentId: id },
      orderBy: { borrowedAt: 'desc' },
    });
    return this.enrichBorrowingsWithBookInfo(borrowings);
  }

  /**
   * §3.3 "Actions" tab — audit trail of operations on this reader's OWN
   * account row (create/update/delete of the LibraryStudent record itself,
   * not their borrowing activity — that's the Reading History tab).
   * `audit_log` is a core, platform-wide table on the same shared Prisma
   * client this service already reads `User` through (see this class's own
   * docblock) — not a cross-module service import.
   *
   * The raw `oldValue`/`newValue` are the LibraryStudent row's own columns
   * (`id`, `userId`, `code`, `className`, `academicYearId`, `createdAt`,
   * `updatedAt`) — a librarian reading this tab has no use for a raw UUID,
   * so both the actor and the changed fields are resolved into names here,
   * not left for the frontend to try to make sense of.
   */
  async getActionHistory(id: string) {
    await this.getOrThrow(id);
    const entries = await this.prisma.auditLog.findMany({
      where: { entityType: 'LibraryStudent', entityId: id },
      orderBy: { occurredAt: 'desc' },
    });
    if (entries.length === 0) return [];

    const actorIds = [...new Set(entries.map((e) => e.actorUserId).filter((v): v is string => v !== null))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const actorNameById = new Map(actors.map((a) => [a.id, a.name]));

    return entries.map((entry) => ({
      id: entry.id,
      occurredAt: entry.occurredAt,
      actorType: entry.actorType,
      actorName: entry.actorUserId ? (actorNameById.get(entry.actorUserId) ?? null) : null,
      action: entry.action,
      changes: this.describeStudentRowChange(entry.oldValue as Record<string, unknown> | null, entry.newValue as Record<string, unknown> | null),
    }));
  }

  /** LibraryStudent row column -> human label, for the Actions tab's diff display. `id`/`userId` are deliberately omitted — a raw UUID means nothing to a librarian and the reader is already identified by the page they're on. */
  private static readonly STUDENT_FIELD_LABELS: Record<string, string> = {
    code: 'library_circulation.students.code',
    className: 'library_circulation.students.class_name',
    academicYearId: 'library_circulation.students.academic_year',
  };

  private describeStudentRowChange(
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
  ): { field: string; before: unknown; after: unknown }[] {
    const relevantFields = Object.keys(StudentsService.STUDENT_FIELD_LABELS);
    const source = newValue ?? oldValue ?? {};
    const changes: { field: string; before: unknown; after: unknown }[] = [];
    for (const field of relevantFields) {
      if (!(field in source)) continue;
      const before = oldValue?.[field] ?? null;
      const after = newValue?.[field] ?? null;
      if (before === after) continue;
      changes.push({ field, before, after });
    }
    return changes;
  }

  async create(dto: CreateStudentDto, createdBy: string): Promise<CreatedStudent> {
    const temporaryPassword = randomBytes(9).toString('base64url'); // ~12 chars, URL-safe
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });

    const readerRole = await this.prisma.role.findUnique({ where: { code: READER_ROLE_CODE } });
    if (!readerRole) {
      throw new BadRequestException(`The "${READER_ROLE_CODE}" role does not exist — cannot create a student account`);
    }

    try {
      const student = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            mustChangePassword: true,
            createdBy,
          },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: readerRole.id, assignedBy: createdBy } });
        const created = await tx.libraryStudent.create({
          data: {
            userId: user.id,
            code: dto.code,
            className: dto.className,
            academicYearId: dto.academicYearId,
          },
        });
        return { ...created, name: user.name, email: user.email };
      });

      return { ...student, temporaryPassword };
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async update(id: string, dto: UpdateStudentDto) {
    await this.getOrThrow(id);
    try {
      return await this.prisma.libraryStudent.update({
        where: { id },
        data: { code: dto.code, className: dto.className, academicYearId: dto.academicYearId },
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  /** §22: a student with borrowing history can never be deleted. */
  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    const historyCount = await this.prisma.libraryBorrowing.count({ where: { studentId: id } });
    if (historyCount > 0) {
      throw new ConflictException('This student has borrowing history and cannot be deleted (§22 — history is permanent).');
    }
    await this.prisma.libraryStudent.delete({ where: { id } });
  }

  async findByCode(code: string) {
    const student = await this.prisma.libraryStudent.findUnique({ where: { code } });
    if (!student) {
      throw new NotFoundException(`No student found for code "${code}"`);
    }
    return student;
  }

  async countActiveBorrowings(studentId: string): Promise<number> {
    return this.prisma.libraryBorrowing.count({ where: { studentId, status: { in: ['active', 'overdue'] } } });
  }

  // --- internals -----------------------------------------------------------

  private async getOrThrow(id: string) {
    const student = await this.prisma.libraryStudent.findUnique({ where: { id } });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    return student;
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return new ConflictException(`A student or user with this ${target} already exists`);
    }
    return error;
  }
}
