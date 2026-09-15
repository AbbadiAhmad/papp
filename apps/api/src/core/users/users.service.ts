import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { assertPasswordMeetsPolicy } from '../auth/password-policy.util';
import { SettingsService } from '../settings/settings.service';
import { PASSWORD_POLICY_KEY, PasswordPolicy } from '../settings/settings.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, toPublicUser } from './user.presenter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private getPasswordPolicy(): Promise<PasswordPolicy> {
    return this.settings.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }

  async findById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toPublicUser(user);
  }

  async create(dto: CreateUserDto, createdBy?: string): Promise<PublicUser> {
    const policy = await this.getPasswordPolicy();
    assertPasswordMeetsPolicy(dto.password, policy);
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash,
          externalId: dto.externalId,
          department: dto.department,
          mustChangePassword: dto.mustChangePassword ?? true,
          createdBy,
        },
      });
      return toPublicUser(user);
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findById(id); // 404s consistently before attempting the write

    const data: Prisma.UserUpdateInput = {
      email: dto.email,
      name: dto.name,
      externalId: dto.externalId,
      department: dto.department,
      isActive: dto.isActive,
    };

    if (dto.password !== undefined) {
      const policy = await this.getPasswordPolicy();
      assertPasswordMeetsPolicy(dto.password, policy);
      data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
      // An admin resetting someone's password forces a change at next login,
      // unless the caller explicitly overrides mustChangePassword below.
      data.mustChangePassword = true;
    }

    if (dto.mustChangePassword !== undefined) {
      data.mustChangePassword = dto.mustChangePassword;
    }

    try {
      const user = await this.prisma.user.update({ where: { id }, data });
      return toPublicUser(user);
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.user.delete({ where: { id } });
  }

  private translateUniqueConstraintError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return new ConflictException(`A user with this ${target} already exists`);
    }
    return error;
  }
}
