import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const READER_ROLE_CODE = 'reader';
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const STUDENT_CODE_PREFIX = 'R';
const STUDENT_CODE_DIGITS = 6;
const STUDENT_CODE_SEQUENCE = 'library_students_code_seq';
const MAX_CODE_ALLOCATION_ATTEMPTS = 50;

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

  /**
   * Bug fix (user-reported): the Students list page showed only `code` +
   * `className` — no name — forcing the librarian to open each reader just
   * to see who it was. `libraryStudent` doesn't store the name itself (D41:
   * name lives on the platform `User`), so it's joined in here the same way
   * `search()` above already does, just as one batched `User.findMany` by
   * `userId` rather than a per-row lookup.
   */
  /**
   * The Readers list is DERIVED from the platform's users: a profile is
   * listed while its user currently holds the `reader` role (granted or
   * revoked in core Users — nothing here caches that), plus anyone, reader
   * or not any more, who still has a book out (active/overdue) so an
   * unreturned book never disappears from circulation.
   */
  private async visibilityFilter(): Promise<Prisma.LibraryStudentWhereInput> {
    const readerUserIds = await this.currentReaderUserIds();
    return {
      OR: [{ userId: { in: [...readerUserIds] } }, { borrowings: { some: { status: { in: ['active', 'overdue'] } } } }],
    };
  }

  private async currentReaderUserIds(): Promise<Set<string>> {
    const rows = await this.prisma.userRole.findMany({ where: { role: { code: READER_ROLE_CODE } }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  /** Every visible reader, unpaged — Excel export and other modules' pickers (reading_club) use this. */
  async list() {
    await this.syncReaderProfiles();
    const visible = await this.visibilityFilter();
    const students = await this.prisma.libraryStudent.findMany({ where: visible, orderBy: { createdAt: 'desc' } });
    return this.enrichForList(students);
  }

  /** Readers table: filtered, sorted and paginated ON THE SERVER, so `total` is the filtered count and every page is consistent. */
  async listPaged(dto: ListStudentsDto) {
    await this.syncReaderProfiles();
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 25;
    const and: Prisma.LibraryStudentWhereInput[] = [await this.visibilityFilter()];

    const q = dto.q?.trim();
    if (q) {
      const contains = { contains: q, mode: 'insensitive' as const };
      const matchingUsers = await this.prisma.user.findMany({
        where: { OR: [{ name: contains }, { email: contains }, { externalId: contains }, { department: contains }] },
        select: { id: true },
      });
      and.push({ OR: [{ code: contains }, { className: contains }, { userId: { in: matchingUsers.map((u) => u.id) } }] });
    }
    if (dto.className?.trim()) {
      and.push({ className: { contains: dto.className.trim(), mode: 'insensitive' } });
    }
    if (dto.status === 'active' || dto.status === 'inactive') {
      const inactive = await this.prisma.user.findMany({ where: { isActive: false }, select: { id: true } });
      const inactiveIds = inactive.map((u) => u.id);
      and.push({ userId: dto.status === 'inactive' ? { in: inactiveIds } : { notIn: inactiveIds } });
    }
    const openStatuses = { in: ['active', 'overdue'] };
    if (dto.borrowing === 'out') {
      and.push({ borrowings: { some: { status: openStatuses } } });
    } else if (dto.borrowing === 'overdue') {
      // 'overdue' is set lazily; an active loan past its due date is just as late.
      and.push({ borrowings: { some: { OR: [{ status: 'overdue' }, { status: 'active', dueAt: { lt: new Date() } }] } } });
    } else if (dto.borrowing === 'none') {
      and.push({ borrowings: { none: { status: openStatuses } } });
    }

    const where: Prisma.LibraryStudentWhereInput = { AND: and };
    const sortBy = dto.sortBy ?? 'createdAt';
    const sortDir = dto.sortDir ?? (sortBy === 'createdAt' ? 'desc' : 'asc');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.libraryStudent.count({ where }),
      this.prisma.libraryStudent.findMany({
        where,
        // `id` as a tiebreaker keeps page boundaries stable when many rows share the sort value.
        orderBy: [{ [sortBy]: sortDir }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: await this.enrichForList(rows), total, page, pageSize };
  }

  /** Joins the account fields, "is still a reader" flag and current-loan count onto profile rows. */
  private async enrichForList(students: Awaited<ReturnType<PrismaClient['libraryStudent']['findMany']>>) {
    const readerUserIds = await this.currentReaderUserIds();
    const userIds = [...new Set(students.map((s) => s.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, isActive: true, externalId: true, department: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    // Books each listed reader currently has out (active + overdue) — one grouped query, not one per row.
    const openLoans = students.length
      ? await this.prisma.libraryBorrowing.groupBy({
          by: ['studentId'],
          where: { studentId: { in: students.map((s) => s.id) }, status: { in: ['active', 'overdue'] } },
          _count: { _all: true },
        })
      : [];
    const openLoansByStudent = new Map(openLoans.map((r) => [r.studentId, r._count._all]));
    return students.map((s) => {
      const u = userById.get(s.userId);
      return {
        ...s,
        /** false = role revoked but still listed because a book is out. */
        isReader: readerUserIds.has(s.userId),
        activeBorrowingsCount: openLoansByStudent.get(s.id) ?? 0,
        name: u?.name ?? null,
        email: u?.email ?? null,
        isActive: u?.isActive ?? true,
        externalId: u?.externalId ?? null,
        department: u?.department ?? null,
      };
    });
  }

  /**
   * Bug fix (user-reported): a reader who self-registers (core
   * `AuthService.register()`) gets a platform User with the `reader` role
   * but no `library_students` row — core knows nothing about this module —
   * so they never appeared in the Readers list, the search picker or a code
   * scan. This module can't hook the register call (modules never patch
   * core), so every read path that must see ALL readers first creates the
   * missing profile, with the next auto-generated code. One set-based
   * INSERT; `ON CONFLICT DO NOTHING` makes concurrent callers safe (a code
   * that collides with a hand-typed one is simply retried on the next call —
   * the sequence has already moved on).
   */
  async syncReaderProfiles(): Promise<void> {
    try {
      await this.insertMissingReaderProfiles();
    } catch (error) {
      // Best-effort: a failure here (e.g. module migration 006/007 not applied yet, so the code
      // sequence doesn't exist) must never take down the read that called it — list/search/count/
      // scan still work for the profiles that already exist.
      this.logger.error(`Could not create profiles for reader-role users: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async insertMissingReaderProfiles(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO library_students (id, user_id, code, created_at, updated_at)
       SELECT gen_random_uuid(), u.id,
              '${STUDENT_CODE_PREFIX}' || lpad(nextval('${STUDENT_CODE_SEQUENCE}')::text, ${STUDENT_CODE_DIGITS}, '0'),
              now(), now()
         FROM users u
        WHERE EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.code = $1)
          AND NOT EXISTS (SELECT 1 FROM library_students s WHERE s.user_id = u.id)
        ORDER BY u.created_at
       ON CONFLICT DO NOTHING`,
      READER_ROLE_CODE,
    );
  }

  /** Read-only preview of the code the next create WOULD get (does not consume the sequence) — mirrors library_catalog's `peekNextCopyCode()`. */
  async peekNextCode(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ last_value: bigint; is_called: boolean }>>(
      `SELECT last_value, is_called FROM ${STUDENT_CODE_SEQUENCE}`,
    );
    const { last_value, is_called } = rows[0];
    let next = is_called ? last_value + BigInt(1) : last_value;
    // Skip values a hand-typed code already occupies, so the suggestion is never a guaranteed conflict.
    for (let i = 0; i < MAX_CODE_ALLOCATION_ATTEMPTS; i++) {
      const candidate = this.formatCode(next);
      if (!(await this.prisma.libraryStudent.findUnique({ where: { code: candidate }, select: { id: true } }))) return candidate;
      next += BigInt(1);
    }
    return this.formatCode(next);
  }

  /** Consumes the sequence; skips any value already taken by a manually-typed code. */
  async allocateCode(client: Pick<PrismaClient, '$queryRawUnsafe' | 'libraryStudent'> = this.prisma): Promise<string> {
    for (let i = 0; i < MAX_CODE_ALLOCATION_ATTEMPTS; i++) {
      const rows = await client.$queryRawUnsafe<Array<{ nextval: bigint }>>(`SELECT nextval('${STUDENT_CODE_SEQUENCE}') AS nextval`);
      const candidate = this.formatCode(rows[0].nextval);
      if (!(await client.libraryStudent.findUnique({ where: { code: candidate }, select: { id: true } }))) return candidate;
    }
    throw new ConflictException('Could not allocate a free reader code — please type one manually');
  }

  /** A manually typed code in the R<digits> format fast-forwards the sequence past it (never backwards) — same as library_catalog's copy codes. */
  async reconcileCodeSequence(client: Pick<PrismaClient, '$queryRawUnsafe'>, enteredCode: string): Promise<void> {
    const match = new RegExp(`^${STUDENT_CODE_PREFIX}(\\d+)$`).exec(enteredCode);
    if (!match) return;
    await client.$queryRawUnsafe(
      `SELECT setval('${STUDENT_CODE_SEQUENCE}', GREATEST($1::bigint, (SELECT last_value FROM ${STUDENT_CODE_SEQUENCE})), true)`,
      BigInt(match[1]),
    );
  }

  private formatCode(value: bigint): string {
    return `${STUDENT_CODE_PREFIX}${value.toString().padStart(STUDENT_CODE_DIGITS, '0')}`;
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
    await this.syncReaderProfiles();
    const visible = await this.visibilityFilter();

    const [byCode, matchingUsers] = await Promise.all([
      this.prisma.libraryStudent.findMany({
        where: { AND: [{ code: { contains: q, mode: 'insensitive' } }, visible] },
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
          where: { AND: [{ userId: { in: matchingUsers.map((u) => u.id) } }, visible] },
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
    await this.syncReaderProfiles();
    return this.prisma.libraryStudent.count({ where: await this.visibilityFilter() });
  }

  async findById(id: string) {
    const student = await this.getOrThrow(id);
    const [user, activeBorrowingsRaw, openFines, allFines] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: student.userId }, select: { name: true, email: true, isActive: true, externalId: true, department: true, mustChangePassword: true } }),
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
      externalId: user?.externalId ?? null,
      department: user?.department ?? null,
      mustChangePassword: user?.mustChangePassword ?? false,
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
  ): Promise<(T & { qrCode: string | null; bookTitle: string | null; readingLevel: string | null; category: string | null })[]> {
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
        category: book?.category ?? null,
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
    name: 'library_circulation.students.name',
    email: 'library_circulation.students.email',
    externalId: 'library_circulation.students.external_id',
    department: 'library_circulation.students.department',
    isActive: 'library_circulation.students.is_active',
    mustChangePassword: 'library_circulation.students.must_change_password',
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
      throw new BadRequestException(`The "${READER_ROLE_CODE}" role does not exist — cannot create a reader account`);
    }

    const requestedCode = dto.code?.trim();
    try {
      const student = await this.prisma.$transaction(async (tx) => {
        // Blank code -> next incremental one; a typed one is kept and bumps the sequence past itself.
        const code = requestedCode || (await this.allocateCode(tx));
        if (requestedCode) await this.reconcileCodeSequence(tx, requestedCode);
        const user = await tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            externalId: dto.externalId || undefined,
            department: dto.department || undefined,
            passwordHash,
            mustChangePassword: true,
            createdBy,
          },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: readerRole.id, assignedBy: createdBy } });
        const created = await tx.libraryStudent.create({
          data: {
            userId: user.id,
            code,
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

  /**
   * Edits the library profile AND the linked platform account (name, email,
   * external ID, department, active flag, forced-password-change, password
   * reset) in one transaction — everything core's Edit User offers except
   * roles. Deactivation is refused for an account that also holds a
   * non-reader role: that account can be an admin/staff member, and the
   * last-admin protection lives in core Users, which is where it must be
   * deactivated.
   */
  async update(id: string, dto: UpdateStudentDto) {
    const student = await this.getOrThrow(id);
    const requestedCode = dto.code?.trim();

    if (dto.isActive === false) {
      const otherRoles = await this.prisma.userRole.count({ where: { userId: student.userId, role: { code: { not: READER_ROLE_CODE } } } });
      if (otherRoles > 0) {
        throw new ConflictException('This account also holds other roles — deactivate it from Users instead.');
      }
    }

    let temporaryPassword: string | undefined;
    const userData: Prisma.UserUpdateInput = {
      name: dto.name,
      email: dto.email,
      externalId: dto.externalId,
      department: dto.department,
      isActive: dto.isActive,
      mustChangePassword: dto.mustChangePassword,
    };
    if (dto.resetPassword) {
      temporaryPassword = randomBytes(9).toString('base64url');
      userData.passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
      userData.mustChangePassword = true;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.values(userData).some((v) => v !== undefined)) {
          await tx.user.update({ where: { id: student.userId }, data: userData });
        }
        if (requestedCode) await this.reconcileCodeSequence(tx, requestedCode);
        await tx.libraryStudent.update({
          where: { id },
          data: {
            code: requestedCode,
            // Empty string clears the field; undefined leaves it alone.
            className: dto.className === undefined ? undefined : dto.className.trim() || null,
            academicYearId: dto.academicYearId,
          },
        });
      });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }

    const updated = await this.findProfileWithUser(id);
    return temporaryPassword ? { ...updated, temporaryPassword } : updated;
  }

  /** Profile row joined with the user fields the edit form shows — also what the audit trail records (never the hash). */
  async findProfileWithUser(id: string) {
    const student = await this.getOrThrow(id);
    const user = await this.prisma.user.findUnique({
      where: { id: student.userId },
      select: { name: true, email: true, externalId: true, department: true, isActive: true, mustChangePassword: true },
    });
    return { ...student, ...user };
  }

  /** §22: a reader with borrowing history can never be deleted. */
  async remove(id: string): Promise<void> {
    const student = await this.getOrThrow(id);
    const historyCount = await this.prisma.libraryBorrowing.count({ where: { studentId: id } });
    if (historyCount > 0) {
      throw new ConflictException('This reader has borrowing history and cannot be deleted (§22 — history is permanent).');
    }
    // The account itself stays (it may own other data) but stops being a reader — otherwise
    // syncReaderProfiles() would just recreate the profile on the next list.
    await this.prisma.$transaction(async (tx) => {
      await tx.libraryStudent.delete({ where: { id } });
      await tx.userRole.deleteMany({ where: { userId: student.userId, role: { code: READER_ROLE_CODE } } });
    });
  }

  async findByCode(code: string) {
    await this.syncReaderProfiles();
    const student = await this.prisma.libraryStudent.findUnique({ where: { code } });
    if (!student) {
      throw new NotFoundException(`No reader found for code "${code}"`);
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
      throw new NotFoundException('Reader not found');
    }
    return student;
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return new ConflictException(`A reader or user with this ${target} already exists`);
    }
    return error;
  }
}
