import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PublicRole, toPublicRole } from './role.presenter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

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

  /** Idempotent: unassigning a role the user doesn't hold is a no-op. */
  async unassignFromUser(roleId: string, userId: string): Promise<void> {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
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
