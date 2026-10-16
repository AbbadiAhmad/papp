"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SurveyAccessService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyAccessGuard = exports.SurveyAccessService = exports.PERMISSIONS_READER = exports.SurveyAccess = exports.SURVEY_ACCESS_KEY = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const client_1 = require("@prisma/client");
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
exports.SURVEY_ACCESS_KEY = 'surveyAccess';
const SurveyAccess = (code, options = {}) => (0, common_1.SetMetadata)(exports.SURVEY_ACCESS_KEY, { code, ...options });
exports.SurveyAccess = SurveyAccess;
/** The slice of core's PermissionsService this module needs; bound with `useExisting` in survey.module.ts (the D74 pattern). */
exports.PERMISSIONS_READER = Symbol('SURVEY_PERMISSIONS_READER');
let SurveyAccessService = SurveyAccessService_1 = class SurveyAccessService {
    permissions;
    logger = new common_1.Logger(SurveyAccessService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(permissions) {
        this.permissions = permissions;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('survey access Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async isCoOwner(surveyId, userId) {
        return (await this.prisma.surveyCollaborator.count({ where: { surveyId, userId } })) > 0;
    }
    /** The ids of the surveys the user co-owns (for the list page). */
    async coOwnedIds(userId) {
        const rows = await this.prisma.surveyCollaborator.findMany({ where: { userId }, select: { surveyId: true } });
        return new Set(rows.map((r) => r.surveyId));
    }
    async permissionsOf(userId) {
        return this.permissions.getEffectivePermissionCodes(userId);
    }
    /** What `userId` may do with a survey, for the UI (the server enforces independently, route by route). */
    capabilities(perms, userId, survey, coOwner) {
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
    async ownerOf(surveyId) {
        const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { ownerUserId: true } });
        if (!survey)
            throw new common_1.NotFoundException('Survey not found');
        return survey.ownerUserId;
    }
    // --- co-owner management ---------------------------------------------
    async listCoOwners(surveyId) {
        const ownerUserId = await this.ownerOf(surveyId);
        const rows = await this.prisma.surveyCollaborator.findMany({ where: { surveyId }, orderBy: { createdAt: 'asc' } });
        const ids = [ownerUserId, ...rows.map((r) => r.userId)];
        const users = await this.prisma.$queryRaw `
      SELECT id, email, name FROM users WHERE id = ANY(${ids}::uuid[])`;
        const label = (id) => {
            const u = users.find((x) => x.id === id);
            return { userId: id, email: u?.email ?? '', name: u?.name || (u?.email ?? '') };
        };
        return {
            owner: label(ownerUserId),
            coOwners: rows.map((r) => ({ ...label(r.userId), addedAt: r.createdAt })),
        };
    }
    async addCoOwner(surveyId, email, addedBy) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
            throw new common_1.BadRequestException('Enter a valid email address');
        const ownerUserId = await this.ownerOf(surveyId);
        const found = await this.prisma.$queryRaw `
      SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) AND is_active = true LIMIT 1`;
        if (found.length === 0)
            throw new common_1.NotFoundException('No active user has that email address');
        const userId = found[0].id;
        if (userId === ownerUserId)
            throw new common_1.ForbiddenException('That user already owns this survey');
        await this.prisma.surveyCollaborator.upsert({
            where: { surveyId_userId: { surveyId, userId } },
            create: { surveyId, userId, addedBy },
            update: {},
        });
        return this.listCoOwners(surveyId);
    }
    async removeCoOwner(surveyId, userId) {
        await this.ownerOf(surveyId);
        await this.prisma.surveyCollaborator.deleteMany({ where: { surveyId, userId } });
        return this.listCoOwners(surveyId);
    }
};
exports.SurveyAccessService = SurveyAccessService;
exports.SurveyAccessService = SurveyAccessService = SurveyAccessService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(exports.PERMISSIONS_READER)),
    __metadata("design:paramtypes", [Object])
], SurveyAccessService);
/** Applied (with MustChangePasswordGuard) on controllers that carry `@SurveyAccess(...)` routes; routes without the metadata pass. */
let SurveyAccessGuard = class SurveyAccessGuard {
    reflector;
    access;
    constructor(reflector, access) {
        this.reflector = reflector;
        this.access = access;
    }
    async canActivate(context) {
        const rule = this.reflector.get(exports.SURVEY_ACCESS_KEY, context.getHandler());
        if (!rule)
            return true;
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user)
            throw new common_1.ForbiddenException(`Missing required permission: ${rule.code}`);
        const perms = await this.access.permissionsOf(user.userId);
        if (perms.has(rule.code))
            return true;
        const surveyId = request.params.id;
        if (surveyId) {
            if (rule.collaborator && (await this.access.isCoOwner(surveyId, user.userId)))
                return true;
            if (rule.owner && (await this.access.ownerOf(surveyId)) === user.userId)
                return true;
        }
        throw new common_1.ForbiddenException(`Missing required permission: ${rule.code}`);
    }
};
exports.SurveyAccessGuard = SurveyAccessGuard;
exports.SurveyAccessGuard = SurveyAccessGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        SurveyAccessService])
], SurveyAccessGuard);
