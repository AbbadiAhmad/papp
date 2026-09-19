import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PublicRole, toPublicRole } from './role.presenter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** The one role every "must always have at least one holder" guard below protects. Matches the `role.code === 'admin'` convention documented in `permissions-page.guard.ts` — never `isSystem` (that flag also covers `library_assistant`/`finance`/`reader`, which have no such invariant). */
const PROTECTED_ROLE_CODE = 'admin';
/** Arbitrary fixed key for `pg_advisory_xact_lock`, same pattern/reasoning as `auth.service.ts`'s `SETUP_ADVISORY_LOCK_KEY` — serializes the count-then-act window for the last-admin guard below so concurrent requests can't both see "2 left" and both proceed. Any int8 works; this one has no other meaning. */
const LAST_ADMIN_GUARD_ADVISORY_LOCK_KEY = 8_411_960_028n;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PublicRole[]> {
    const roles = await this.prisma.role.findMany({ orderBy: { code: 'asc' } });
    return roles.map(toPublicRole);
  }

  async findById(id: string): Promise<PublicRole> {
    const role = await this.findRoleOrThrow(id);
    return toPublicRole(role);
  }

  async create(dto: CreateRoleDto): Promise<PublicRole> {
    try {
      // Roles created through the API are never `isSystem` — that flag is
      // reserved for the 4 base roles seeded by the migration.
      const role = await this.prisma.role.create({
        data: { code: dto.code, nameI18nKey: dto.nameI18nKey, isSystem: false },
      });
      return toPublicRole(role);
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async update(id: string, dto: UpdateRoleDto): Promise<PublicRole> {
    await this.findRoleOrThrow(id);
    const role = await this.prisma.role.update({ where: { id }, data: { nameI18nKey: dto.nameI18nKey } });
    return toPublicRole(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findRoleOrThrow(id);
    if (role.isSystem) {
      throw new ForbiddenException('System roles (admin, library_assistant, finance, reader) cannot be deleted');
    }
    await this.prisma.role.delete({ where: { id } });
  }

  async listRolesForUser(userId: string): Promise<PublicRole[]> {
    const userRoles = await this.prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    return userRoles.map((ur) => toPublicRole(ur.role));
  }

  /** Idempotent: assigning an already-held role is a no-op, not an error. */
  async assignToUser(roleId: string, userId: string, assignedBy?: string): Promise<void> {
    await this.findRoleOrThrow(roleId);
    await this.assertUserExists(userId);
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId, assignedBy },
    });
  }

  /**
   * Idempotent: unassigning a role the user doesn't hold is a no-op.
   * Guarded against orphaning the platform (see `assertNotLastActiveAdmin`
   * below) when the role being removed is `admin` — everything else
   * (reader/finance/library_assistant, or any admin-created role) has no
   * such invariant and is removed unconditionally.
   */
  async unassignFromUser(roleId: string, userId: string): Promise<void> {
    const role = await this.findRoleOrThrow(roleId);
    if (role.code !== PROTECTED_ROLE_CODE) {
      await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.assertNotLastActiveAdmin(tx, userId);
      await tx.userRole.deleteMany({ where: { userId, roleId } });
    });
  }

  /**
   * Throws `ForbiddenException` if `candidateUserId` is CURRENTLY one of the
   * platform's remaining active `admin`-role users and removing them (by
   * deletion, deactivation, or role unassignment — this helper doesn't care
   * which) would leave zero. Callers run this INSIDE the same `tx` as the
   * actual mutation, guarded by `pg_advisory_xact_lock` taken first — same
   * concurrency reasoning as `AuthService.setupCreateFirstAdmin` (root
   * D60/A27/D80): plain "count, then act" is not atomic under Postgres's
   * default READ COMMITTED isolation, so two concurrent requests removing
   * two DIFFERENT admins could both see "more than one left" and both
   * proceed, together zeroing out the role. The lock serializes this one
   * critical section platform-wide (a single fixed key, not per-user) —
   * acceptable cost since removing an admin is a rare admin-console action,
   * never a hot path.
   *
   * Deliberately counts by `role.code === 'admin'`, not `isSystem` — the
   * one documented exception to "never hardcode a role name" in this
   * codebase (`permissions-page.guard.ts`'s own docblock), because this is
   * fundamentally the same "platform bootstrap/safety" concern as that
   * guard, not a feature-permission check a future role could opt into.
   */
  async assertNotLastActiveAdmin(tx: Prisma.TransactionClient | PrismaClient, candidateUserId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LAST_ADMIN_GUARD_ADVISORY_LOCK_KEY})`;

    const activeAdminUserIds = await tx.userRole.findMany({
      where: { role: { code: PROTECTED_ROLE_CODE }, user: { isActive: true } },
      select: { userId: true },
    });
    const remainingAfter = activeAdminUserIds.filter((ur) => ur.userId !== candidateUserId);

    if (activeAdminUserIds.some((ur) => ur.userId === candidateUserId) && remainingAfter.length === 0) {
      throw new ForbiddenException(
        'This is the last active admin account. At least one active admin must always exist — assign another user the admin role first.',
      );
    }
  }

  private async findRoleOrThrow(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return new ConflictException('A role with this code already exists');
    }
    return error;
  }
}
