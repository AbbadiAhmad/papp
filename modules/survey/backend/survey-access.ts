import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from './platform';

/**
 * Per-survey access (survey ext. G, SURVEY-D21).
 *
 * Plain RBAC still decides everything first: a user who holds the permission code may act on EVERY survey, as
 * before. On top of that, a CO-OWNER of one survey may use the routes marked `collaborator: true` (edit, publish,
 * read the results) on that survey only, and the survey's creator may manage its co-owners. Routes marked this way
 * carry `@SurveyAccess(code, ...)` INSTEAD of `@RequirePermission(code)`, because the platform's global guard
 * would reject a co-owner whose role lacks the code before this module could look at the survey; the guard below
 * then makes the same permission check itself and adds the per-survey rule. Same code, same 403 message.
 */

export const SURVEY_ACCESS_KEY = 'surveyAccess';

export interface SurveyAccessRule {
  /** The permission code that grants this on every survey (must be declared in manifest.json). */
  code: string;
  /** Co-owners of the survey may also do this. */
  collaborator?: boolean;
  /** The survey's creator may also do this (managing co-owners). */
  owner?: boolean;
}

export const SurveyAccess = (code: string, options: { collaborator?: boolean; owner?: boolean } = {}): MethodDecorator =>
  SetMetadata(SURVEY_ACCESS_KEY, { code, ...options } satisfies SurveyAccessRule);

/** The slice of core's PermissionsService this module needs; bound with `useExisting` in survey.module.ts (the D74 pattern). */
export const PERMISSIONS_READER = Symbol('SURVEY_PERMISSIONS_READER');
export interface PermissionsReader {
  getEffectivePermissionCodes(userId: string): Promise<Set<string>>;
}

export interface SurveyCapabilities {
  canEdit: boolean;
  canPublish: boolean;
  canViewResults: boolean;
  canExportResults: boolean;
  canManageOwners: boolean;
  isCoOwner: boolean;
}

@Injectable()
export class SurveyAccessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SurveyAccessService.name);
  private readonly prisma = new PrismaClient();

  constructor(@Inject(PERMISSIONS_READER) private readonly permissions: PermissionsReader) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('survey access Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async isCoOwner(surveyId: string, userId: string): Promise<boolean> {
    return (await this.prisma.surveyCollaborator.count({ where: { surveyId, userId } })) > 0;
  }

  /** The ids of the surveys the user co-owns (for the list page). */
  async coOwnedIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.surveyCollaborator.findMany({ where: { userId }, select: { surveyId: true } });
    return new Set(rows.map((r) => r.surveyId));
  }

  async permissionsOf(userId: string): Promise<Set<string>> {
    return this.permissions.getEffectivePermissionCodes(userId);
  }

  /** What `userId` may do with a survey, for the UI (the server enforces independently, route by route). */
  capabilities(perms: Set<string>, userId: string, survey: { ownerUserId: string }, coOwner: boolean): SurveyCapabilities {
    const isOwner = survey.ownerUserId === userId;
    return {
      canEdit: perms.has('survey.surveys.update') || coOwner,
      canPublish: perms.has('survey.surveys.publish') || coOwner,
      canViewResults: perms.has('survey.responses.view') || coOwner,
      canExportResults: perms.has('survey.responses.export') || coOwner,
      canManageOwners: perms.has('survey.surveys.share') || isOwner,
      isCoOwner: coOwner,
    };
  }

  async ownerOf(surveyId: string): Promise<string> {
    const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { ownerUserId: true } });
    if (!survey) throw new NotFoundException('Survey not found');
    return survey.ownerUserId;
  }

  // --- co-owner management ---------------------------------------------

  async listCoOwners(surveyId: string) {
    const ownerUserId = await this.ownerOf(surveyId);
    const rows = await this.prisma.surveyCollaborator.findMany({ where: { surveyId }, orderBy: { createdAt: 'asc' } });
    const ids = [ownerUserId, ...rows.map((r) => r.userId)];
    const users = await this.prisma.$queryRaw<Array<{ id: string; email: string; name: string | null }>>`
      SELECT id, email, name FROM users WHERE id = ANY(${ids}::uuid[])`;
    const label = (id: string) => {
      const u = users.find((x) => x.id === id);
      return { userId: id, email: u?.email ?? '', name: u?.name || (u?.email ?? '') };
    };
    return {
      owner: label(ownerUserId),
      coOwners: rows.map((r) => ({ ...label(r.userId), addedAt: r.createdAt })),
    };
  }

  async addCoOwner(surveyId: string, email: string, addedBy: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new BadRequestException('Enter a valid email address');
    const ownerUserId = await this.ownerOf(surveyId);
    const found = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) AND is_active = true LIMIT 1`;
    if (found.length === 0) throw new NotFoundException('No active user has that email address');
    const userId = found[0].id;
    if (userId === ownerUserId) throw new ForbiddenException('That user already owns this survey');
    await this.prisma.surveyCollaborator.upsert({
      where: { surveyId_userId: { surveyId, userId } },
      create: { surveyId, userId, addedBy },
      update: {},
    });
    return this.listCoOwners(surveyId);
  }

  async removeCoOwner(surveyId: string, userId: string) {
    await this.ownerOf(surveyId);
    await this.prisma.surveyCollaborator.deleteMany({ where: { surveyId, userId } });
    return this.listCoOwners(surveyId);
  }
}

/** Applied (with MustChangePasswordGuard) on controllers that carry `@SurveyAccess(...)` routes; routes without the metadata pass. */
@Injectable()
export class SurveyAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: SurveyAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<SurveyAccessRule | undefined>(SURVEY_ACCESS_KEY, context.getHandler());
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException(`Missing required permission: ${rule.code}`);

    const perms = await this.access.permissionsOf(user.userId);
    if (perms.has(rule.code)) return true;

    const surveyId = request.params.id as string | undefined;
    if (surveyId) {
      if (rule.collaborator && (await this.access.isCoOwner(surveyId, user.userId))) return true;
      if (rule.owner && (await this.access.ownerOf(surveyId)) === user.userId) return true;
    }
    throw new ForbiddenException(`Missing required permission: ${rule.code}`);
  }
}
