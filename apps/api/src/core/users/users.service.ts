import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { assertPasswordMeetsPolicy } from '../auth/password-policy.util';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import {
  FORCE_PASSWORD_CHANGE_TEMPLATE_KEY,
  NotificationTemplate,
  PASSWORD_POLICY_KEY,
  PASSWORD_RESET_TEMPLATE_KEY,
  PasswordPolicy,
} from '../settings/settings.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, toPublicUser } from './user.presenter';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    // @Optional + appended last: same fixture-friendliness rule as
    // SettingsService's AuditLogWriter — lightweight unit fixtures may
    // construct UsersService(prisma, settings) without the notification
    // pipeline; in the real app UsersModule always provides it.
    @Optional() private readonly notifications?: NotificationsService,
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
    const before = await this.findById(id); // 404s consistently before attempting the write

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

    let user;
    try {
      user = await this.prisma.user.update({ where: { id }, data });
    } catch (error) {
      throw this.translateUniqueConstraintError(error);
    }

    // Phase 4 wiring (BUILD_PLAN.md Phase 4): an admin-driven password
    // reset, or newly flipping mustChangePassword on, notifies the affected
    // user through the Notification Center using the admin-editable
    // template (in-app always; email too when the category has email
    // enabled AND SMTP is configured). Runs AFTER the update committed and
    // never fails it. A password reset wins over the bare flag flip — the
    // reset notice already tells the user a new password is required.
    if (dto.password !== undefined) {
      await this.notifyFromTemplate(user.id, 'auth.password_reset', PASSWORD_RESET_TEMPLATE_KEY);
    } else if (dto.mustChangePassword === true && !before.mustChangePassword) {
      await this.notifyFromTemplate(user.id, 'auth.force_password_change', FORCE_PASSWORD_CHANGE_TEMPLATE_KEY);
    }

    return toPublicUser(user);
  }

  /**
   * Sends the notification described by an admin-editable template
   * (ARCHITECTURE.md §12.3): the template's `subject` becomes the title and
   * its `bodyMarkdown` the body — {{name}} is substituted per recipient at
   * render time by NotificationsService. `sentBy: null` because these are
   * system-generated notices (§12.1), triggered by an admin action whose
   * accountability already lives in the users PATCH audit row.
   */
  private async notifyFromTemplate(userId: string, category: string, templateKey: string): Promise<void> {
    if (!this.notifications) {
      this.logger.error(
        `User ${userId} should have received a "${category}" notification but NO NotificationsService is ` +
          'wired — this must never occur outside an isolated unit-test fixture.',
      );
      return;
    }
    try {
      const template = await this.settings.get<NotificationTemplate>(templateKey);
      await this.notifications.send({
        category,
        title: template.subject,
        bodyMarkdown: template.bodyMarkdown,
        targetType: 'user',
        targetId: userId,
        sentBy: null,
      });
    } catch (error) {
      this.logger.error(
        `FAILED to send the "${category}" notification to user ${userId} — the underlying user update ` +
          'itself succeeded.',
        error instanceof Error ? error.stack : String(error),
      );
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
