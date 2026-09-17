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

  async count(): Promise<number> {
    return this.prisma.libraryStudent.count();
  }

  async findById(id: string) {
    const student = await this.getOrThrow(id);
    const [activeBorrowings, openFines] = await Promise.all([
      this.prisma.libraryBorrowing.findMany({
        where: { studentId: id, status: { in: ['active', 'overdue'] } },
        orderBy: { borrowedAt: 'desc' },
      }),
      this.prisma.libraryFine.findMany({
        where: { studentId: id, status: { in: ['unpaid', 'partially_paid'] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { ...student, activeBorrowings, openFines };
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
