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
var ResponsesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponsesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const node_crypto_1 = require("node:crypto");
// The REAL core classes, imported from apps/api's BUILT output — same
// established exception category as PublicThrottlerGuard (platform.ts's
// docblock, D57). `AuditLogWriter` is exported by a `@Global()` module
// (AuditModule), so it's injectable here via ordinary Nest DI with no
// `imports:` ceremony in survey.module.ts, exactly as its own docblock
// promises ("injectable everywhere it is needed"). `NotificationsService`/
// `NotificationEmailService` are NOT global — survey.module.ts imports
// their module (`NotificationsModule`, also from dist) explicitly.
// eslint-disable-next-line import/no-unresolved
const audit_log_writer_1 = require("../../../apps/api/dist/core/audit/audit-log.writer");
// eslint-disable-next-line import/no-unresolved
const notification_email_service_1 = require("../../../apps/api/dist/core/notifications/notification-email.service");
// eslint-disable-next-line import/no-unresolved
const notifications_service_1 = require("../../../apps/api/dist/core/notifications/notifications.service");
const logic_engine_1 = require("./logic-engine");
/**
 * The respondent-facing flow — shared by BOTH the authenticated fill
 * controller and the public/anonymous one (docs/DECISIONS.md's two-endpoint
 * split; this is the one place their logic actually converges). Same
 * dedicated `PrismaClient` pattern as SurveysService.
 */
let ResponsesService = ResponsesService_1 = class ResponsesService {
    auditLogWriter;
    notifications;
    notificationEmail;
    logger = new common_1.Logger(ResponsesService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(auditLogWriter, notifications, notificationEmail) {
        this.auditLogWriter = auditLogWriter;
        this.notifications = notifications;
        this.notificationEmail = notificationEmail;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('survey (responses) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    /**
     * The full fillable structure, plus the caller's own existing response if
     * one exists (edit pre-fill) — only looked up at all when
     * `oneResponsePerRespondent` is on; when it's off, "the most recent one"
     * isn't a meaningful thing to pre-fill (each submit is independent).
     */
    async getForFilling(surveyId, respondentUserId) {
        const survey = await this.getPublishedSurveyWithStructure(surveyId);
        const existing = respondentUserId && survey.oneResponsePerRespondent
            ? await this.prisma.surveyResponse.findFirst({
                where: { surveyId, respondentUserId },
                include: { answers: true },
                orderBy: { submittedAt: 'desc' },
            })
            : null;
        return { survey: this.toPublicSurvey(survey), existingResponse: existing ? this.toPublicResponse(existing) : null };
    }
    /**
     * Authenticated path: create-or-update the CALLER's own response.
     * `oneResponsePerRespondent` (default true) is what decides whether an
     * existing response is even looked for at all — when the admin has
     * switched it off, every submit is independent and this always creates a
     * brand-new row (only meaningful for a KNOWN respondent; an anonymous one
     * is never deduplicated in the first place — see the migration's own
     * comment on this column).
     */
    async submitAuthenticated(surveyId, respondentUserId, respondentSessionId, answers, meta) {
        const survey = await this.getPublishedSurveyWithStructure(surveyId);
        const existing = survey.oneResponsePerRespondent
            ? await this.prisma.surveyResponse.findFirst({ where: { surveyId, respondentUserId } })
            : null;
        if (existing && !survey.allowEditAfterSubmit) {
            throw new common_1.ConflictException('You have already responded to this survey and editing is disabled');
        }
        const user = await this.prisma.$queryRaw `SELECT email FROM users WHERE id = ${respondentUserId}::uuid`;
        const respondentEmail = user[0]?.email ?? null;
        const actor = { actorType: 'user', actorUserId: respondentUserId, actorSessionId: respondentSessionId };
        if (existing) {
            return this.writeResponse(survey, answers, {
                responseId: existing.id,
                respondentUserId,
                respondentEmail,
                meta,
                isEdit: true,
                actor,
            });
        }
        return this.writeResponse(survey, answers, { respondentUserId, respondentEmail, meta, isEdit: false, actor });
    }
    /** Public path: create a brand-new anonymous response. */
    async submitPublic(surveyId, answers, meta) {
        const survey = await this.getPublishedSurveyWithStructure(surveyId);
        if (survey.requiresLogin) {
            throw new common_1.ForbiddenException('This survey requires you to log in before responding');
        }
        let editToken = null;
        let editTokenHash;
        if (survey.allowEditAfterSubmit) {
            editToken = (0, node_crypto_1.randomBytes)(32).toString('hex');
            editTokenHash = this.hashEditToken(editToken);
        }
        const actor = { actorType: 'anonymous', actorUserId: null, actorSessionId: null };
        const result = await this.writeResponse(survey, answers, {
            respondentUserId: null,
            respondentEmail: null,
            editTokenHash,
            meta,
            isEdit: false,
            actor,
        });
        return { responseId: result.id, editToken };
    }
    /**
     * Public path: edit a previously-submitted anonymous response via its edit
     * token alone — no responseId in the URL at all (the token, a 32-byte
     * random secret hashed at rest exactly like a refresh token, is already
     * unique enough to look the response up by; requiring the id too would
     * add nothing but a second thing the shared link has to carry).
     */
    async editPublic(surveyId, editToken, answers, meta) {
        const survey = await this.getPublishedSurveyWithStructure(surveyId);
        if (!survey.allowEditAfterSubmit) {
            throw new common_1.ForbiddenException('Editing responses is disabled for this survey');
        }
        const editTokenHash = this.hashEditToken(editToken);
        const existing = await this.prisma.surveyResponse.findFirst({
            where: { surveyId, respondentUserId: null, editTokenHash },
        });
        if (!existing) {
            throw new common_1.ForbiddenException('Invalid edit link');
        }
        return this.writeResponse(survey, answers, {
            responseId: existing.id,
            respondentUserId: null,
            respondentEmail: null,
            editTokenHash: existing.editTokenHash ?? undefined,
            meta,
            isEdit: true,
            actor: { actorType: 'anonymous', actorUserId: null, actorSessionId: null },
        });
    }
    // --- internals -------------------------------------------------------
    hashEditToken(rawToken) {
        return (0, node_crypto_1.createHash)('sha256').update(rawToken, 'utf8').digest('hex');
    }
    async getPublishedSurveyWithStructure(surveyId) {
        const survey = await this.prisma.surveySurvey.findUnique({
            where: { id: surveyId },
            include: {
                sections: { orderBy: { orderIndex: 'asc' }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } } },
                logicRules: true,
            },
        });
        // Never distinguishes "doesn't exist" from "not published" to an
        // anonymous/authenticated respondent — same 404-not-403 rule
        // MODULE_SPEC.md §7.2 already applies to library_catalog's public route.
        if (!survey || survey.status !== 'published') {
            throw new common_1.NotFoundException('Survey not found');
        }
        return survey;
    }
    toPublicSurvey(survey) {
        return {
            id: survey.id,
            title: survey.title,
            description: survey.description,
            allowEditAfterSubmit: survey.allowEditAfterSubmit,
            // Lets the frontend show a "please log in" prompt UPFRONT for the
            // anonymous caller, before they fill out the whole form, rather than
            // only discovering it from submitPublic's 403 at the very end.
            requiresLogin: survey.requiresLogin,
            sections: survey.sections.map((s) => ({
                id: s.id,
                questions: s.questions.map((q) => ({
                    id: q.id,
                    type: q.type,
                    title: q.title,
                    description: q.description,
                    required: q.required,
                    config: q.config,
                    options: q.options.map((o) => ({ value: o.value, label: o.label })),
                })),
            })),
            logicRules: survey.logicRules,
        };
    }
    toPublicResponse(response) {
        return { id: response.id, answers: response.answers.map((a) => ({ questionId: a.questionId, value: a.value })) };
    }
    /**
     * Cross-checks the submitted answer set against the REAL structure and the
     * REAL logic-engine result — never trusts the client's own visibility
     * computation. A currently-hidden question's answer is silently dropped
     * (the respondent never saw it, so it can't count); a currently-visible
     * REQUIRED question with no answer rejects the whole submission.
     */
    validateAndNormalizeAnswers(survey, answers) {
        const questionsById = new Map(survey.sections.flatMap((s) => s.questions.map((q) => [q.id, q])));
        const answerByQuestionId = new Map();
        for (const a of answers) {
            if (!questionsById.has(a.questionId)) {
                throw new common_1.BadRequestException(`Unknown question ${a.questionId}`);
            }
            answerByQuestionId.set(a.questionId, a.value);
        }
        const enumerationAnswers = {};
        for (const [questionId, value] of answerByQuestionId) {
            const q = questionsById.get(questionId);
            if (q.type === 'single_choice' || q.type === 'dropdown' || q.type === 'multi_choice') {
                enumerationAnswers[questionId] = value;
            }
        }
        const { visibleQuestionIds } = (0, logic_engine_1.resolveVisibility)(survey.sections.map((s) => ({ id: s.id, questions: s.questions.map((q) => ({ id: q.id })) })), survey.logicRules, enumerationAnswers);
        const normalized = [];
        for (const [sectionId, question] of survey.sections.flatMap((s) => s.questions.map((q) => [s.id, q]))) {
            if (!visibleQuestionIds.has(question.id))
                continue; // never visible -> never counted, regardless of what was sent
            const value = answerByQuestionId.get(question.id);
            if (value === undefined || value === null || value === '') {
                if (question.required) {
                    throw new common_1.BadRequestException(`Question "${question.title}" is required`);
                }
                continue;
            }
            this.validateAnswerShape(question, value);
            normalized.push({ questionId: question.id, value });
            void sectionId; // sectionId kept for readability of the destructure above; not otherwise needed here
        }
        return normalized;
    }
    validateAnswerShape(question, value) {
        switch (question.type) {
            case 'single_choice':
            case 'dropdown': {
                const valid = new Set(question.options.map((o) => o.value));
                if (typeof value !== 'string' || !valid.has(value)) {
                    throw new common_1.BadRequestException(`Invalid option for question "${question.title}"`);
                }
                return;
            }
            case 'multi_choice': {
                const valid = new Set(question.options.map((o) => o.value));
                if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !valid.has(v))) {
                    throw new common_1.BadRequestException(`Invalid option(s) for question "${question.title}"`);
                }
                return;
            }
            case 'linear_scale':
            case 'rating': {
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    throw new common_1.BadRequestException(`Question "${question.title}" expects a number`);
                }
                return;
            }
            case 'short_text':
            case 'paragraph':
            case 'date':
            case 'time':
                if (typeof value !== 'string') {
                    throw new common_1.BadRequestException(`Question "${question.title}" expects text`);
                }
                return;
        }
    }
    async writeResponse(survey, rawAnswers, opts) {
        const answers = this.validateAndNormalizeAnswers(survey, rawAnswers);
        // Only fetched for an edit, and only for the audit row's oldValue — a
        // fresh create has no "before" state.
        const oldAnswers = opts.responseId
            ? await this.prisma.surveyAnswer.findMany({ where: { responseId: opts.responseId }, select: { questionId: true, value: true } })
            : null;
        const response = await this.prisma.$transaction(async (tx) => {
            const responseRow = opts.responseId
                ? await tx.surveyResponse.update({
                    where: { id: opts.responseId },
                    data: { ipAddress: opts.meta.ipAddress, userAgent: opts.meta.userAgent },
                })
                : await tx.surveyResponse.create({
                    data: {
                        surveyId: survey.id,
                        respondentUserId: opts.respondentUserId,
                        respondentEmail: opts.respondentEmail,
                        editTokenHash: opts.editTokenHash,
                        ipAddress: opts.meta.ipAddress,
                        userAgent: opts.meta.userAgent,
                    },
                });
            await tx.surveyAnswer.deleteMany({ where: { responseId: responseRow.id } });
            if (answers.length > 0) {
                await tx.surveyAnswer.createMany({
                    data: answers.map((a) => ({ responseId: responseRow.id, questionId: a.questionId, value: a.value })),
                });
            }
            return responseRow;
        });
        // Written DIRECTLY here rather than via the global @Audit decorator
        // (platform.ts) — deliberately, not an oversight: `submitPublic`'s HTTP
        // response body carries a one-time raw edit token (this.hashEditToken's
        // input) that must NEVER reach a durable log, and @Audit's generic path
        // logs the handler's whole response body as newValue when no
        // `fetchState` is given (a `fetchState` can't help either — it never
        // sees a freshly-created row's id, only the request). Same category of
        // exception as AuthService's own direct login/logout audit rows
        // (audit.interceptor.ts's docblock) — a real mutation that doesn't fit
        // the generic interceptor path, so the service writes its own row
        // through the same `AuditLogWriter` funnel instead.
        // write() never throws (its own docblock) — a failed audit write is
        // loudly logged there and must never fail the response that triggered it.
        await this.auditLogWriter.write({
            actorType: opts.actor.actorType,
            actorUserId: opts.actor.actorUserId,
            actorSessionId: opts.actor.actorSessionId,
            category: 'survey.responses',
            entityType: 'SurveyResponse',
            entityId: response.id,
            action: opts.isEdit ? 'edit' : 'submit',
            oldValue: oldAnswers,
            newValue: { surveyId: survey.id, answers },
            ipAddress: opts.meta.ipAddress ?? null,
            userAgent: opts.meta.userAgent ?? null,
        });
        if (!opts.isEdit) {
            const questionsById = new Map(survey.sections.flatMap((s) => s.questions.map((q) => [q.id, q])));
            const resolvedAnswers = answers.map((a) => ({ question: questionsById.get(a.questionId), value: a.value }));
            await this.notifyOnSubmit(survey, resolvedAnswers, opts.respondentEmail ?? 'Anonymous').catch((error) => {
                this.logger.error('Post-submission notification dispatch failed (response itself was saved successfully)', error);
            });
        }
        return response;
    }
    /**
     * Fires on the INITIAL submit only, never an edit (docs/DECISIONS.md —
     * "completion" notifications, not "change" notifications). Two
     * independent channels, either or both may be configured:
     *  - `notifyOwnerOnSubmit` → the real in-app+email Notification Center,
     *    targeting the owner (a real platform user — D21-compliant).
     *  - `notifyEmails` → the module-owned exception (confirmed with the
     *    user): straight through the shared mail transport to arbitrary
     *    admin-typed addresses, never through NotificationsService's own
     *    platform-users-only targeting.
     */
    async notifyOnSubmit(survey, answers, respondentLabel) {
        const summary = this.buildResponseSummary(survey, answers, respondentLabel);
        if (survey.notifyOwnerOnSubmit) {
            try {
                await this.notifications.send({
                    category: 'survey.responses.submitted',
                    title: `New response: ${survey.title}`,
                    bodyMarkdown: summary.markdown,
                    targetType: 'user',
                    targetId: survey.ownerUserId,
                    sentBy: null,
                });
            }
            catch (error) {
                this.logger.error('Failed to notify survey owner of a new response (response itself was saved successfully)', error);
            }
        }
        const notifyEmails = Array.isArray(survey.notifyEmails)
            ? survey.notifyEmails.filter((value) => typeof value === 'string')
            : [];
        for (const to of notifyEmails) {
            // NotificationEmailService.send() never throws (its own docblock) —
            // no try/catch needed here, unlike NotificationsService.send() above.
            await this.notificationEmail.send({ to, subject: `New response: ${survey.title}`, html: summary.html, text: summary.text });
        }
    }
    buildResponseSummary(survey, answers, respondentLabel) {
        const formatValue = (value) => (Array.isArray(value) ? value.join(', ') : String(value));
        const rows = answers.map((a) => ({ title: a.question.title, value: formatValue(a.value) }));
        const markdown = [
            `New response to **${survey.title}** (respondent: ${respondentLabel})`,
            '',
            ...rows.map((r) => `- **${r.title}**: ${r.value}`),
        ].join('\n');
        const text = [`New response to ${survey.title} (respondent: ${respondentLabel})`, '', ...rows.map((r) => `${r.title}: ${r.value}`)].join('\n');
        const html = [
            `<p>New response to <strong>${escapeHtml(survey.title)}</strong> (respondent: ${escapeHtml(respondentLabel)})</p>`,
            '<ul>',
            ...rows.map((r) => `<li><strong>${escapeHtml(r.title)}</strong>: ${escapeHtml(r.value)}</li>`),
            '</ul>',
        ].join('');
        return { markdown, html, text };
    }
};
exports.ResponsesService = ResponsesService;
exports.ResponsesService = ResponsesService = ResponsesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [audit_log_writer_1.AuditLogWriter,
        notifications_service_1.NotificationsService,
        notification_email_service_1.NotificationEmailService])
], ResponsesService);
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
