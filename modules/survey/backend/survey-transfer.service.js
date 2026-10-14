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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var SurveyTransferService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyTransferService = exports.SURVEY_PACKAGE_VERSION = exports.SURVEY_PACKAGE_FORMAT = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const crypto_1 = require("crypto");
const jszip_1 = __importDefault(require("jszip"));
const survey_structure_dto_1 = require("./dto/survey-structure.dto");
const surveys_service_1 = require("./surveys.service");
exports.SURVEY_PACKAGE_FORMAT = 'papp.survey.package';
exports.SURVEY_PACKAGE_VERSION = 1;
const PACKAGE_ENTRY = 'survey.json';
/** Guards against a zip bomb: the unzipped survey.json may not exceed this. */
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const INSERT_BATCH = 1000;
let SurveyTransferService = SurveyTransferService_1 = class SurveyTransferService {
    surveys;
    logger = new common_1.Logger(SurveyTransferService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(surveys) {
        this.surveys = surveys;
    }
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('survey transfer Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    // --- export ------------------------------------------------------------
    async exportZip(surveyId, includeResponses) {
        const pkg = await this.buildPackage(surveyId, includeResponses);
        const zip = new jszip_1.default();
        zip.file(PACKAGE_ENTRY, JSON.stringify(pkg, null, 2));
        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const safeTitle = pkg.survey.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'survey';
        return { buffer, filename: `${safeTitle}${includeResponses ? '-with-responses' : ''}.zip` };
    }
    // --- duplicate ---------------------------------------------------------
    /** Copies a survey of ANY status (archived and closed included) into a brand-new draft; responses are never copied. */
    async duplicate(surveyId, ownerUserId, title) {
        const pkg = await this.buildPackage(surveyId, false);
        const name = title?.trim() || `${pkg.survey.title} (copy)`;
        return this.createFromPackage(pkg, ownerUserId, { title: name, includeResponses: false });
    }
    // --- import ------------------------------------------------------------
    async importZip(buffer, ownerUserId, includeResponses) {
        let zip;
        try {
            zip = await jszip_1.default.loadAsync(buffer);
        }
        catch {
            throw new common_1.BadRequestException('The uploaded file is not a valid zip archive');
        }
        const entry = zip.file(PACKAGE_ENTRY);
        if (!entry) {
            throw new common_1.BadRequestException(`The archive does not contain ${PACKAGE_ENTRY}`);
        }
        const raw = await entry.async('string');
        if (raw.length > MAX_UNZIPPED_BYTES) {
            throw new common_1.BadRequestException('The survey file is too large');
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new common_1.BadRequestException(`${PACKAGE_ENTRY} is not valid JSON`);
        }
        const pkg = this.validatePackage(parsed);
        return this.createFromPackage(pkg, ownerUserId, { includeResponses });
    }
    // --- internals ---------------------------------------------------------
    async buildPackage(surveyId, includeResponses) {
        const survey = await this.prisma.surveySurvey.findUnique({
            where: { id: surveyId },
            include: {
                sections: {
                    orderBy: { orderIndex: 'asc' },
                    include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } },
                },
                logicRules: { orderBy: { orderIndex: 'asc' } },
                responses: includeResponses ? { orderBy: { submittedAt: 'asc' }, include: { answers: true } } : false,
            },
        });
        if (!survey)
            throw new common_1.NotFoundException('Survey not found');
        const pkg = {
            format: exports.SURVEY_PACKAGE_FORMAT,
            version: exports.SURVEY_PACKAGE_VERSION,
            exportedAt: new Date().toISOString(),
            includesResponses: includeResponses,
            survey: {
                title: survey.title,
                description: survey.description,
                requiresLogin: survey.requiresLogin,
                allowEditAfterSubmit: survey.allowEditAfterSubmit,
                oneResponsePerRespondent: survey.oneResponsePerRespondent,
                notifyOwnerOnSubmit: survey.notifyOwnerOnSubmit,
                notifyEmails: Array.isArray(survey.notifyEmails) ? survey.notifyEmails : [],
                opensAt: survey.opensAt?.toISOString() ?? null,
                closesAt: survey.closesAt?.toISOString() ?? null,
                closedMessage: survey.closedMessage,
            },
            sections: survey.sections.map((s) => ({
                id: s.id,
                orderIndex: s.orderIndex,
                title: s.title,
                description: s.description ?? undefined,
                navigation: (s.navigation ?? {}),
                questions: s.questions.map((q) => ({
                    id: q.id,
                    orderIndex: q.orderIndex,
                    type: q.type,
                    title: q.title,
                    description: q.description ?? undefined,
                    required: q.required,
                    config: (q.config ?? {}),
                    options: q.options.map((o) => ({ id: o.id, orderIndex: o.orderIndex, value: o.value, label: o.label })),
                })),
            })),
            logicRules: survey.logicRules.map((r) => ({
                sourceQuestionId: r.sourceQuestionId,
                sourceOptionValue: r.sourceOptionValue,
                action: r.action,
                targetType: r.targetType,
                targetId: r.targetId,
                orderIndex: r.orderIndex,
            })),
        };
        if (includeResponses) {
            const withAnswers = (survey.responses ?? []);
            pkg.responses = withAnswers.map((r) => ({
                submittedAt: r.submittedAt.toISOString(),
                respondentEmail: r.respondentEmail,
                answers: r.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
            }));
        }
        return pkg;
    }
    /** Never trust an uploaded file: structurally validate it exactly like a builder save. */
    validatePackage(parsed) {
        const obj = parsed;
        if (!obj || typeof obj !== 'object' || obj.format !== exports.SURVEY_PACKAGE_FORMAT) {
            throw new common_1.BadRequestException('This is not a survey package file');
        }
        if (typeof obj.version !== 'number' || obj.version > exports.SURVEY_PACKAGE_VERSION) {
            throw new common_1.BadRequestException(`Unsupported survey package version: ${String(obj.version)}`);
        }
        const settings = obj.survey;
        if (!settings || typeof settings.title !== 'string' || !settings.title.trim()) {
            throw new common_1.BadRequestException('The survey package has no title');
        }
        const structure = (0, class_transformer_1.plainToInstance)(survey_structure_dto_1.SurveyStructureDto, { sections: obj.sections, logicRules: obj.logicRules ?? [] });
        const errors = (0, class_validator_1.validateSync)(structure, { whitelist: true, forbidUnknownValues: true });
        if (errors.length > 0) {
            throw new common_1.BadRequestException('The survey structure in the file is invalid');
        }
        this.surveys.validateStructure(structure);
        return { ...obj, sections: structure.sections, logicRules: structure.logicRules ?? [] };
    }
    async createFromPackage(pkg, ownerUserId, opts) {
        const sectionIds = new Map();
        const questionIds = new Map();
        for (const section of pkg.sections) {
            sectionIds.set(section.id, (0, crypto_1.randomUUID)());
            for (const question of section.questions)
                questionIds.set(question.id, (0, crypto_1.randomUUID)());
        }
        const settings = pkg.survey;
        const newSurveyId = (0, crypto_1.randomUUID)();
        return this.prisma.$transaction(async (tx) => {
            await tx.surveySurvey.create({
                data: {
                    id: newSurveyId,
                    title: opts.title ?? settings.title,
                    description: settings.description,
                    status: 'draft',
                    ownerUserId,
                    requiresLogin: settings.requiresLogin,
                    allowEditAfterSubmit: settings.allowEditAfterSubmit,
                    oneResponsePerRespondent: settings.oneResponsePerRespondent,
                    notifyOwnerOnSubmit: settings.notifyOwnerOnSubmit,
                    notifyEmails: (settings.notifyEmails ?? []),
                    opensAt: settings.opensAt ? new Date(settings.opensAt) : null,
                    closesAt: settings.closesAt ? new Date(settings.closesAt) : null,
                    closedMessage: settings.closedMessage ?? null,
                },
            });
            for (const section of pkg.sections) {
                await tx.surveySection.create({
                    data: {
                        id: sectionIds.get(section.id),
                        surveyId: newSurveyId,
                        orderIndex: section.orderIndex,
                        title: section.title,
                        description: section.description,
                        navigation: this.remapNavigation(section.navigation, sectionIds, questionIds),
                    },
                });
                for (const question of section.questions) {
                    const newQuestionId = questionIds.get(question.id);
                    await tx.surveyQuestion.create({
                        data: {
                            id: newQuestionId,
                            sectionId: sectionIds.get(section.id),
                            orderIndex: question.orderIndex,
                            type: question.type,
                            title: question.title,
                            description: question.description,
                            required: question.required ?? false,
                            config: (question.config ?? {}),
                        },
                    });
                    if (question.options?.length) {
                        await tx.surveyQuestionOption.createMany({
                            data: question.options.map((o) => ({
                                id: (0, crypto_1.randomUUID)(),
                                questionId: newQuestionId,
                                orderIndex: o.orderIndex,
                                value: o.value,
                                label: o.label,
                            })),
                        });
                    }
                }
            }
            if (pkg.logicRules.length) {
                await tx.surveyLogicRule.createMany({
                    data: pkg.logicRules.map((r) => ({
                        surveyId: newSurveyId,
                        sourceQuestionId: questionIds.get(r.sourceQuestionId),
                        sourceOptionValue: r.sourceOptionValue,
                        action: r.action,
                        targetType: r.targetType,
                        targetId: (r.targetType === 'section' ? sectionIds : questionIds).get(r.targetId),
                        orderIndex: r.orderIndex,
                    })),
                });
            }
            if (opts.includeResponses && pkg.responses?.length) {
                await this.insertResponses(tx, newSurveyId, pkg.responses, questionIds);
            }
            return tx.surveySurvey.findUniqueOrThrow({ where: { id: newSurveyId } });
        }, { timeout: 120_000 });
    }
    /** Section ids / question ids inside the navigation JSON are rewritten to the freshly minted ones. */
    remapNavigation(nav, sectionIds, questionIds) {
        const mapTarget = (target) => (target === 'submit' ? target : (sectionIds.get(target) ?? target));
        return {
            ...(nav?.defaultTarget ? { defaultTarget: mapTarget(nav.defaultTarget) } : {}),
            ...(nav?.routes?.length
                ? {
                    routes: nav.routes.map((r) => ({
                        sourceQuestionId: questionIds.get(r.sourceQuestionId) ?? r.sourceQuestionId,
                        sourceOptionValue: r.sourceOptionValue,
                        target: mapTarget(r.target),
                    })),
                }
                : {}),
        };
    }
    async insertResponses(tx, surveyId, responses, questionIds) {
        for (let start = 0; start < responses.length; start += INSERT_BATCH) {
            const batch = responses.slice(start, start + INSERT_BATCH);
            const rows = batch.map((r) => ({ id: (0, crypto_1.randomUUID)(), r }));
            await tx.surveyResponse.createMany({
                data: rows.map(({ id, r }) => {
                    const submittedAt = new Date(r.submittedAt);
                    if (Number.isNaN(submittedAt.getTime()))
                        throw new common_1.BadRequestException('A response in the file has an invalid submittedAt');
                    return { id, surveyId, respondentEmail: r.respondentEmail ?? null, submittedAt };
                }),
            });
            const answers = rows.flatMap(({ id, r }) => (r.answers ?? [])
                .filter((a) => questionIds.has(a.questionId) && a.value !== null && a.value !== undefined)
                .map((a) => ({ responseId: id, questionId: questionIds.get(a.questionId), value: (a.value ?? null) })));
            if (answers.length)
                await tx.surveyAnswer.createMany({ data: answers, skipDuplicates: true });
        }
    }
};
exports.SurveyTransferService = SurveyTransferService;
exports.SurveyTransferService = SurveyTransferService = SurveyTransferService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [surveys_service_1.SurveysService])
], SurveyTransferService);
