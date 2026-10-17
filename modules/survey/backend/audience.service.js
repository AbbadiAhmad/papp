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
var AudienceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudienceService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
// eslint-disable-next-line import/no-unresolved
const notification_email_service_1 = require("../../../apps/api/dist/core/notifications/notification-email.service");
const email_list_1 = require("./email-list");
const invitations_1 = require("./invitations");
const rich_text_1 = require("./rich-text");
const survey_settings_1 = require("./survey-settings");
/** A person is reminded at most once per day. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/**
 * Who may respond (SURVEY-D22). A survey that is not restricted is open to anyone its other settings allow. A
 * restricted one accepts: a logged-in user on its allowed list; the holder of a genuine personal invitation link
 * whose invitation still exists; or a logged-in user whose account email matches an invitation. Own PrismaClient.
 */
let AudienceService = AudienceService_1 = class AudienceService {
    mail;
    logger = new common_1.Logger(AudienceService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(mail) {
        this.mail = mail;
    }
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    // --- the gate used by the respondent paths -------------------------------
    async check(survey, caller) {
        if ((0, survey_settings_1.normalizeSettings)(survey.settings).restricted !== true)
            return { via: 'open' };
        const invitationId = (0, invitations_1.readInviteToken)(caller.inviteToken);
        if (invitationId) {
            const row = await this.prisma.surveyInvitation.findFirst({ where: { id: invitationId, surveyId: survey.id } });
            if (row)
                return { via: 'invitation', invitationId: row.id };
        }
        if (caller.userId) {
            if ((await this.prisma.surveyAllowedUser.count({ where: { surveyId: survey.id, userId: caller.userId } })) > 0)
                return { via: 'user' };
            const rows = await this.prisma.$queryRaw `SELECT lower(email) AS email FROM users WHERE id = ${caller.userId}::uuid`;
            if (rows[0]) {
                const byEmail = await this.prisma.surveyInvitation.findFirst({ where: { surveyId: survey.id, email: rows[0].email } });
                if (byEmail)
                    return { via: 'invitation', invitationId: byEmail.id };
            }
        }
        throw new common_1.ForbiddenException({ statusCode: 403, message: 'This survey is by invitation only', restricted: true });
    }
    async markOpened(invitationId) {
        await this.prisma.surveyInvitation.updateMany({ where: { id: invitationId, openedAt: null }, data: { openedAt: new Date() } });
    }
    /** Inside the response transaction: claim the invitation; false when it was already used (one answer per invitation). */
    async claimInvitation(tx, invitationId) {
        const claimed = await tx.surveyInvitation.updateMany({ where: { id: invitationId, respondedAt: null }, data: { respondedAt: new Date() } });
        return claimed.count === 1;
    }
    async invitationEmail(invitationId) {
        return (await this.prisma.surveyInvitation.findUnique({ where: { id: invitationId }, select: { email: true } }))?.email ?? null;
    }
    // --- management ---------------------------------------------------------
    async surveyOrThrow(surveyId) {
        const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId } });
        if (!survey)
            throw new common_1.NotFoundException('Survey not found');
        return survey;
    }
    async getAudience(surveyId) {
        const survey = await this.surveyOrThrow(surveyId);
        const [allowed, invitations] = await Promise.all([
            this.prisma.surveyAllowedUser.findMany({ where: { surveyId }, orderBy: { createdAt: 'asc' } }),
            this.prisma.surveyInvitation.findMany({ where: { surveyId }, orderBy: { invitedAt: 'asc' } }),
        ]);
        const users = allowed.length
            ? await this.prisma.$queryRaw `SELECT id, email, name FROM users WHERE id = ANY(${allowed.map((a) => a.userId)}::uuid[])`
            : [];
        return {
            restricted: (0, survey_settings_1.normalizeSettings)(survey.settings).restricted === true,
            allowedUsers: allowed.map((a) => {
                const u = users.find((x) => x.id === a.userId);
                return { userId: a.userId, email: u?.email ?? '', name: u?.name || (u?.email ?? '') };
            }),
            invitations: invitations.map((i) => ({
                id: i.id,
                email: i.email,
                status: i.respondedAt ? 'responded' : i.openedAt ? 'opened' : 'invited',
                invitedAt: i.invitedAt,
                openedAt: i.openedAt,
                respondedAt: i.respondedAt,
                lastReminderAt: i.lastReminderAt,
                reminderCount: i.reminderCount,
            })),
        };
    }
    async addAllowedUser(surveyId, email, addedBy) {
        await this.surveyOrThrow(surveyId);
        const found = await this.prisma.$queryRaw `SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) AND is_active = true LIMIT 1`;
        if (found.length === 0)
            throw new common_1.NotFoundException('No active user has that email address');
        await this.prisma.surveyAllowedUser.upsert({
            where: { surveyId_userId: { surveyId, userId: found[0].id } },
            create: { surveyId, userId: found[0].id, addedBy },
            update: {},
        });
        return { userId: found[0].id };
    }
    async removeAllowedUser(surveyId, userId) {
        await this.surveyOrThrow(surveyId);
        await this.prisma.surveyAllowedUser.deleteMany({ where: { surveyId, userId } });
        return { userId };
    }
    requireSendable(survey) {
        if (survey.status !== 'published' || survey.archivedAt)
            throw new common_1.ConflictException('Publish the survey before sending invitations');
        const base = (0, invitations_1.appPublicUrl)();
        if (!base)
            throw new common_1.ConflictException('APP_PUBLIC_URL is not set on the server, so invitation links cannot be built');
        return base;
    }
    /** Creates invitations for the new addresses and emails each their personal link. Existing addresses are left alone. */
    async invite(surveyId, rawEmails, invitedBy) {
        const survey = await this.surveyOrThrow(surveyId);
        const base = this.requireSendable(survey);
        const parsed = (0, email_list_1.parseEmailList)(rawEmails.join('\n'));
        if (parsed.valid.length === 0)
            throw new common_1.BadRequestException('No valid email address was given');
        if (parsed.valid.length > email_list_1.MAX_INVITES_PER_REQUEST)
            throw new common_1.BadRequestException(`At most ${email_list_1.MAX_INVITES_PER_REQUEST} invitations can be sent at once`);
        const existing = new Set((await this.prisma.surveyInvitation.findMany({ where: { surveyId, email: { in: parsed.valid } }, select: { email: true } })).map((r) => r.email));
        const fresh = parsed.valid.filter((e) => !existing.has(e));
        let sent = 0;
        let failed = 0;
        for (const email of fresh) {
            const row = await this.prisma.surveyInvitation.create({ data: { surveyId, email, invitedBy } });
            const ok = await this.mail.send({ to: email, ...(0, invitations_1.buildInviteMail)({ title: (0, rich_text_1.toPlainText)(survey.title), link: (0, invitations_1.inviteLink)(base, surveyId, row.id), reminder: false, closesAt: survey.closesAt }) });
            if (ok)
                sent += 1;
            else
                failed += 1;
        }
        return { invited: fresh.length, alreadyInvited: parsed.valid.length - fresh.length, invalid: parsed.invalid, sent, failed };
    }
    /** Reminds everyone who has not answered (and was not already reminded in the last 24 hours). */
    async remind(surveyId) {
        const survey = await this.surveyOrThrow(surveyId);
        const base = this.requireSendable(survey);
        const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS);
        const due = await this.prisma.surveyInvitation.findMany({
            where: { surveyId, respondedAt: null, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cutoff } }] },
        });
        let sent = 0;
        let failed = 0;
        for (const row of due) {
            const ok = await this.mail.send({ to: row.email, ...(0, invitations_1.buildInviteMail)({ title: (0, rich_text_1.toPlainText)(survey.title), link: (0, invitations_1.inviteLink)(base, surveyId, row.id), reminder: true, closesAt: survey.closesAt }) });
            if (ok) {
                sent += 1;
                await this.prisma.surveyInvitation.update({ where: { id: row.id }, data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } } });
            }
            else {
                failed += 1;
            }
        }
        return { reminded: sent, failed, skipped: (await this.prisma.surveyInvitation.count({ where: { surveyId, respondedAt: null } })) - due.length };
    }
    async removeInvitation(surveyId, invitationId) {
        await this.surveyOrThrow(surveyId);
        await this.prisma.surveyInvitation.deleteMany({ where: { id: invitationId, surveyId } });
        return { invitationId };
    }
};
exports.AudienceService = AudienceService;
exports.AudienceService = AudienceService = AudienceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [notification_email_service_1.NotificationEmailService])
], AudienceService);
