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
var SurveysService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveysService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const survey_structure_dto_1 = require("./dto/survey-structure.dto");
const media_service_1 = require("./media.service");
const media_rules_1 = require("./media-rules");
const question_rules_1 = require("./question-rules");
const piping_1 = require("./piping");
const question_rules_2 = require("./question-rules");
const survey_settings_1 = require("./survey-settings");
/**
 * Real `PrismaClient` instance, not core's `PrismaService` — see
 * books.service.ts's own docblock in modules/library_catalog for the full
 * module-boundary rationale (a repo-relative import of core's PrismaService
 * would only resolve at runtime under one specific execution mode; a second
 * connection pool against the same generated client is the robust,
 * precedented choice every module makes).
 */
/** Normalised JSON stored in `survey_sections.navigation` ('{}' = just continue to the next section). */
function navigationOf(section) {
    const nav = section.navigation;
    return {
        ...(nav?.defaultTarget ? { defaultTarget: nav.defaultTarget } : {}),
        ...(nav?.routes?.length
            ? { routes: nav.routes.map((r) => ({ sourceQuestionId: r.sourceQuestionId, sourceOptionValue: r.sourceOptionValue, target: r.target })) }
            : {}),
    };
}
/** The section picture as stored (`null` = none); shape was already checked by validateStructure. */
function imageOf(section) {
    const parsed = (0, question_rules_1.parseImageRef)(section.image);
    return 'ref' in parsed && parsed.ref ? parsed.ref : client_1.Prisma.DbNull;
}
let SurveysService = SurveysService_1 = class SurveysService {
    media;
    logger = new common_1.Logger(SurveysService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(media) {
        this.media = media;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('survey Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list(archived = false) {
        const surveys = await this.prisma.surveySurvey.findMany({
            where: { archivedAt: archived ? { not: null } : null },
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { responses: true } } },
        });
        return surveys.map((s) => ({
            id: s.id,
            ownerUserId: s.ownerUserId,
            title: s.title,
            description: s.description,
            status: s.status,
            archivedAt: s.archivedAt,
            requiresLogin: s.requiresLogin,
            responseCount: s._count.responses,
            opensAt: s.opensAt,
            closesAt: s.closesAt,
            responseLimit: s.responseLimit,
            // open / not_open_yet / ended / full for a published survey, null otherwise (the list shows a hint chip).
            availability: (0, survey_settings_1.computeAvailability)(s, s._count.responses),
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        }));
    }
    async create(dto, ownerUserId) {
        return this.prisma.surveySurvey.create({
            data: { title: dto.title, description: dto.description, ownerUserId },
        });
    }
    async findById(id) {
        const survey = await this.getSurveyOrThrow(id, {
            sections: { orderBy: { orderIndex: 'asc' }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } } },
            logicRules: { orderBy: { orderIndex: 'asc' } },
        });
        return survey;
    }
    async update(id, dto) {
        const current = await this.getSurveyOrThrow(id);
        // Effective values after this change (undefined = keep, null = clear), checked together so
        // "closes before it opens" is caught even when only one of the two dates is being edited.
        const opensAt = dto.opensAt === undefined ? current.opensAt : dto.opensAt;
        const closesAt = dto.closesAt === undefined ? current.closesAt : dto.closesAt;
        const problem = (0, survey_settings_1.validateSurveyOptions)({ thankYouMessage: dto.thankYouMessage, responseLimit: dto.responseLimit, opensAt, closesAt });
        if (problem)
            throw new common_1.BadRequestException(problem);
        // Survey-level options live in one JSONB column; merge the incoming keys into what is stored.
        let settings;
        let headerImage = (0, survey_settings_1.normalizeSettings)(current.settings).headerImage;
        if (dto.headerImage !== undefined) {
            const parsed = (0, question_rules_1.parseImageRef)(dto.headerImage);
            if ('error' in parsed)
                throw new common_1.BadRequestException(parsed.error);
            await this.media.assertOwned(id, parsed.ref ? [parsed.ref.mediaId] : []);
            headerImage = parsed.ref ?? undefined;
        }
        if (dto.thankYouMessage !== undefined || dto.showProgressBar !== undefined || dto.headerImage !== undefined) {
            settings = (0, survey_settings_1.normalizeSettings)({
                ...(0, survey_settings_1.normalizeSettings)(current.settings),
                ...(dto.thankYouMessage !== undefined ? { thankYouMessage: dto.thankYouMessage } : {}),
                ...(dto.showProgressBar !== undefined ? { showProgressBar: dto.showProgressBar } : {}),
                headerImage: headerImage,
            });
        }
        const updated = await this.prisma.surveySurvey.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                requiresLogin: dto.requiresLogin,
                allowEditAfterSubmit: dto.allowEditAfterSubmit,
                oneResponsePerRespondent: dto.oneResponsePerRespondent,
                notifyOwnerOnSubmit: dto.notifyOwnerOnSubmit,
                notifyEmails: dto.notifyEmails,
                opensAt: dto.opensAt,
                closesAt: dto.closesAt,
                responseLimit: dto.responseLimit,
                settings,
                closedMessage: dto.closedMessage === undefined ? undefined : dto.closedMessage.trim() || null,
            },
        });
        if (dto.headerImage !== undefined)
            await this.media.collectGarbage(id);
        return updated;
    }
    async remove(id) {
        await this.getSurveyOrThrow(id);
        const pictures = await this.media.listFor(id);
        await this.prisma.surveySurvey.delete({ where: { id } });
        await this.media.removeFiles(pictures);
    }
    async publish(id) {
        const survey = await this.getSurveyOrThrow(id, {
            sections: { include: { questions: true } },
        });
        this.assertNotArchived(survey);
        if (survey.status === 'published')
            return survey;
        if (survey.sections.length === 0 || survey.sections.every((s) => s.questions.length === 0)) {
            throw new common_1.BadRequestException('Cannot publish a survey with no questions');
        }
        return this.prisma.surveySurvey.update({ where: { id }, data: { status: 'published' } });
    }
    async close(id) {
        const survey = await this.getSurveyOrThrow(id);
        if (survey.status !== 'published') {
            throw new common_1.ConflictException('Only a published survey can be closed');
        }
        return this.prisma.surveySurvey.update({ where: { id }, data: { status: 'closed' } });
    }
    /** Moves a survey to the archive; a published one is closed first so it stops taking responses. */
    async archive(id) {
        const survey = await this.getSurveyOrThrow(id);
        if (survey.archivedAt)
            return survey;
        return this.prisma.surveySurvey.update({
            where: { id },
            data: { archivedAt: new Date(), status: survey.status === 'published' ? 'closed' : survey.status },
        });
    }
    /** Brings an archived survey back to the main list (its status is left as it was — a restored survey is never silently reopened). */
    async unarchive(id) {
        await this.getSurveyOrThrow(id);
        return this.prisma.surveySurvey.update({ where: { id }, data: { archivedAt: null } });
    }
    assertNotArchived(survey) {
        if (survey.archivedAt) {
            throw new common_1.ConflictException('Restore this survey from the archive first');
        }
    }
    /** closed -> published again (a closed survey was previously a dead end). */
    async reopen(id) {
        const survey = await this.getSurveyOrThrow(id);
        this.assertNotArchived(survey);
        if (survey.status !== 'closed') {
            throw new common_1.ConflictException('Only a closed survey can be reopened');
        }
        return this.prisma.surveySurvey.update({ where: { id }, data: { status: 'published' } });
    }
    /**
     * Whole-tree replace (docs/DECISIONS.md): upserts every section/question/
     * option by its (always client-supplied, always a real UUID — see
     * SurveyStructureDto's own comments) id, deletes anything belonging to
     * this survey that ISN'T present in the payload, and replaces the logic
     * rules wholesale. One transaction — a partial save would leave dangling
     * logic rules pointing at deleted questions.
     */
    async replaceStructure(surveyId, dto) {
        await this.getSurveyOrThrow(surveyId);
        this.validateStructure(dto);
        await this.media.assertOwned(surveyId, (0, media_rules_1.collectMediaIds)({ sections: dto.sections }));
        const saved = await this.prisma.$transaction(async (tx) => {
            const keepSectionIds = dto.sections.map((s) => s.id);
            const keepQuestionIds = dto.sections.flatMap((s) => s.questions.map((q) => q.id));
            const keepOptionIds = dto.sections.flatMap((s) => s.questions.flatMap((q) => (q.options ?? []).map((o) => o.id)));
            // Delete anything belonging to this survey that's no longer present —
            // cascades (ON DELETE CASCADE) take care of that section/question's
            // own options/answers/logic-rule references. An empty keep-list omits
            // the `id` filter entirely (delete everything in scope) rather than
            // using a non-UUID sentinel like `['__none__']` in `notIn` — the `id`
            // columns are real `uuid` columns, so Postgres rejects a non-UUID
            // literal even inside a `NOT IN` list (this is a real, previously-
            // hit bug: any all-text-question survey has zero options, and a
            // section can legitimately have zero questions — both are common,
            // not edge cases).
            await tx.surveySection.deleteMany({
                where: keepSectionIds.length ? { surveyId, id: { notIn: keepSectionIds } } : { surveyId },
            });
            await tx.surveyQuestion.deleteMany({
                where: keepQuestionIds.length ? { section: { surveyId }, id: { notIn: keepQuestionIds } } : { section: { surveyId } },
            });
            await tx.surveyQuestionOption.deleteMany({
                where: keepOptionIds.length
                    ? { question: { section: { surveyId } }, id: { notIn: keepOptionIds } }
                    : { question: { section: { surveyId } } },
            });
            for (const section of dto.sections) {
                await tx.surveySection.upsert({
                    where: { id: section.id },
                    create: { id: section.id, surveyId, orderIndex: section.orderIndex, title: section.title, description: section.description, navigation: navigationOf(section), image: imageOf(section) },
                    update: { orderIndex: section.orderIndex, title: section.title, description: section.description, navigation: navigationOf(section), image: imageOf(section) },
                });
                for (const question of section.questions) {
                    await tx.surveyQuestion.upsert({
                        where: { id: question.id },
                        create: {
                            id: question.id,
                            sectionId: section.id,
                            orderIndex: question.orderIndex,
                            type: question.type,
                            title: question.title,
                            description: question.description,
                            required: question.required ?? false,
                            config: (question.config ?? {}),
                        },
                        update: {
                            sectionId: section.id,
                            orderIndex: question.orderIndex,
                            type: question.type,
                            title: question.title,
                            description: question.description,
                            required: question.required ?? false,
                            config: (question.config ?? {}),
                        },
                    });
                    for (const option of question.options ?? []) {
                        await tx.surveyQuestionOption.upsert({
                            where: { id: option.id },
                            create: { id: option.id, questionId: question.id, orderIndex: option.orderIndex, value: option.value, label: option.label },
                            update: { orderIndex: option.orderIndex, value: option.value, label: option.label },
                        });
                    }
                }
            }
            // Logic rules are replaced wholesale — far simpler than diffing a
            // small rule list, and rules carry no independent identity a
            // respondent-facing view or another rule ever references by id.
            await tx.surveyLogicRule.deleteMany({ where: { surveyId } });
            if (dto.logicRules?.length) {
                await tx.surveyLogicRule.createMany({
                    data: dto.logicRules.map((rule) => ({
                        surveyId,
                        sourceQuestionId: rule.sourceQuestionId,
                        sourceOptionValue: rule.sourceOptionValue,
                        action: rule.action,
                        targetType: rule.targetType,
                        targetId: rule.targetId,
                        orderIndex: rule.orderIndex,
                    })),
                });
            }
            return tx.surveySurvey.findUniqueOrThrow({
                where: { id: surveyId },
                include: {
                    sections: { orderBy: { orderIndex: 'asc' }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } } },
                    logicRules: { orderBy: { orderIndex: 'asc' } },
                },
            });
        });
        await this.media.collectGarbage(surveyId);
        return saved;
    }
    // --- internals -------------------------------------------------------
    async getSurveyOrThrow(id, include) {
        const survey = await this.prisma.surveySurvey.findUnique({ where: { id }, include });
        if (!survey) {
            throw new common_1.NotFoundException('Survey not found');
        }
        return survey;
    }
    /**
     * Cross-checks that every logic rule's `sourceQuestionId` is a real
     * enumeration-type question (single_choice/multi_choice/dropdown — only
     * those have option values to branch on) within THIS payload, that
     * `sourceOptionValue` is one of that question's own option values, and
     * that every rule's `targetId` refers to a real section/question in this
     * same payload. Never trust a client-supplied id blindly — this runs
     * BEFORE the transaction so a bad rule rejects the whole save with no
     * partial write.
     */
    validateStructure(dto) {
        const questionsById = new Map(dto.sections.flatMap((s) => s.questions.map((q) => [q.id, q])));
        const sectionIds = new Set(dto.sections.map((s) => s.id));
        const sectionOfQuestion = new Map(dto.sections.flatMap((s) => s.questions.map((q) => [q.id, s.id])));
        for (const section of dto.sections) {
            const sectionImage = (0, question_rules_1.parseImageRef)(section.image);
            if ('error' in sectionImage)
                throw new common_1.BadRequestException(`Section "${section.title}": ${sectionImage.error}`);
            for (const question of section.questions) {
                // A question that takes its choices from an earlier one has none of its own (checked by validatePiping below).
                if (survey_structure_dto_1.ENUMERATION_QUESTION_TYPES.includes(question.type) && !(question.options?.length) && !(0, piping_1.getOptionsFrom)({ config: question.config })) {
                    throw new common_1.BadRequestException(`Question "${question.title}" (${question.type}) needs at least one option`);
                }
                // Option values must be unique and not collide with the reserved "Other" encoding; the
                // question's settings (validation, selection limits, "Other", scale...) must fit its type.
                const optionValues = (question.options ?? []).map((o) => o.value);
                const problem = (survey_structure_dto_1.ENUMERATION_QUESTION_TYPES.includes(question.type) ? (0, question_rules_2.validateOptionValues)(optionValues) : null) ??
                    (0, question_rules_2.validateQuestionConfig)(question.type, question.config, optionValues);
                if (problem) {
                    throw new common_1.BadRequestException(`Question "${question.title}": ${(0, question_rules_2.describeProblem)(problem)}`);
                }
            }
        }
        // Piping tokens and carry-forward sources must exist and sit in earlier sections.
        const pipingProblem = (0, piping_1.validatePiping)(dto.sections.map((section) => ({
            id: section.id,
            title: section.title,
            description: section.description,
            questions: section.questions.map((q) => ({
                id: q.id,
                type: q.type,
                title: q.title,
                description: q.description,
                config: q.config,
                options: (q.options ?? []).map((o) => ({ value: o.value, label: o.label })),
            })),
        })), new Set((dto.logicRules ?? []).map((r) => r.sourceQuestionId)));
        if (pipingProblem)
            throw new common_1.BadRequestException(pipingProblem);
        // Section navigation: jumps only go FORWARD (so a survey can never loop),
        // to a real later section or to 'submit'; a route's source is a choice
        // question of the section being left.
        const indexOfSection = new Map(dto.sections.map((s, i) => [s.id, i]));
        dto.sections.forEach((section, index) => {
            const nav = section.navigation;
            if (!nav)
                return;
            const checkTarget = (target) => {
                if (!target || target === 'submit')
                    return;
                const targetIndex = indexOfSection.get(target);
                if (targetIndex === undefined) {
                    throw new common_1.BadRequestException(`Section "${section.title}" navigates to an unknown section`);
                }
                if (targetIndex <= index) {
                    throw new common_1.BadRequestException(`Section "${section.title}" can only go forward to a later section, or submit`);
                }
            };
            checkTarget(nav.defaultTarget);
            for (const route of nav.routes ?? []) {
                checkTarget(route.target);
                const source = section.questions.find((q) => q.id === route.sourceQuestionId);
                if (!source || !survey_structure_dto_1.ENUMERATION_QUESTION_TYPES.includes(source.type)) {
                    throw new common_1.BadRequestException(`Section "${section.title}": a "go to" condition must use a choice question from that same section`);
                }
                if (!(source.options ?? []).some((o) => o.value === route.sourceOptionValue)) {
                    throw new common_1.BadRequestException(`Section "${section.title}": a "go to" condition uses an option that doesn't exist on "${source.title}"`);
                }
            }
        });
        for (const rule of dto.logicRules ?? []) {
            const sourceQuestion = questionsById.get(rule.sourceQuestionId);
            if (!sourceQuestion) {
                throw new common_1.BadRequestException(`Logic rule references unknown source question ${rule.sourceQuestionId}`);
            }
            if (!survey_structure_dto_1.ENUMERATION_QUESTION_TYPES.includes(sourceQuestion.type)) {
                throw new common_1.BadRequestException(`Logic rule's source question "${sourceQuestion.title}" must be single_choice/multi_choice/dropdown, not ${sourceQuestion.type}`);
            }
            const validValues = new Set((sourceQuestion.options ?? []).map((o) => o.value));
            if (!validValues.has(rule.sourceOptionValue)) {
                throw new common_1.BadRequestException(`Logic rule references option value "${rule.sourceOptionValue}" that doesn't exist on question "${sourceQuestion.title}"`);
            }
            const targetExists = rule.targetType === 'section' ? sectionIds.has(rule.targetId) : questionsById.has(rule.targetId);
            if (!targetExists) {
                throw new common_1.BadRequestException(`Logic rule targets unknown ${rule.targetType} ${rule.targetId}`);
            }
            if (rule.targetId === rule.sourceQuestionId) {
                throw new common_1.BadRequestException('A logic rule cannot target its own source question');
            }
            // A question can never show/hide the section it lives in (it could hide
            // itself and become impossible to ever answer again).
            if (rule.targetType === 'section' && sectionOfQuestion.get(rule.sourceQuestionId) === rule.targetId) {
                throw new common_1.BadRequestException(`Question "${sourceQuestion.title}" cannot show or hide its own section`);
            }
        }
    }
};
exports.SurveysService = SurveysService;
exports.SurveysService = SurveysService = SurveysService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [media_service_1.SurveyMediaService])
], SurveysService);
