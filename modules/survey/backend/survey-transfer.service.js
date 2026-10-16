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
const media_service_1 = require("./media.service");
const media_rules_1 = require("./media-rules");
const question_rules_1 = require("./question-rules");
const piping_1 = require("./piping");
const survey_settings_1 = require("./survey-settings");
const surveys_service_1 = require("./surveys.service");
exports.SURVEY_PACKAGE_FORMAT = 'papp.survey.package';
exports.SURVEY_PACKAGE_VERSION = 1;
const PACKAGE_ENTRY = 'survey.json';
/** Guards against a zip bomb: the unzipped survey.json may not exceed this. */
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const INSERT_BATCH = 1000;
let SurveyTransferService = SurveyTransferService_1 = class SurveyTransferService {
    surveys;
    media;
    logger = new common_1.Logger(SurveyTransferService_1.name);
    prisma = new client_1.PrismaClient();
    constructor(surveys, media) {
        this.surveys = surveys;
        this.media = media;
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
        for (const [id, picture] of await this.pictureBytes(pkg)) {
            zip.file(`media/${id}.${(0, media_rules_1.extensionForMime)(picture.mime)}`, picture.bytes);
        }
        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });
        const safeTitle = pkg.survey.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'survey';
        return {
            buffer,
            filename: `${safeTitle}${includeResponses ? '-with-responses' : ''}.zip`,
        };
    }
    // --- duplicate ---------------------------------------------------------
    /** Copies a survey of ANY status (archived and closed included) into a brand-new draft; responses are never copied. */
    async duplicate(surveyId, ownerUserId, title) {
        const pkg = await this.buildPackage(surveyId, false);
        const name = title?.trim() || `${pkg.survey.title} (copy)`;
        const pictures = await this.pictureBytes(pkg);
        return this.createFromPackage(pkg, ownerUserId, {
            title: name,
            includeResponses: false,
            pictures,
        });
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
        const pictures = new Map();
        for (const [name, file] of Object.entries(zip.files)) {
            const match = /^media\/([0-9a-f-]{36})\.(png|jpg|webp)$/i.exec(name);
            if (!match || file.dir || pictures.size >= media_rules_1.MAX_IMAGES_PER_SURVEY)
                continue;
            const bytes = await file.async('uint8array');
            if (bytes.length <= media_rules_1.MAX_IMAGE_BYTES)
                pictures.set(match[1].toLowerCase(), bytes);
        }
        return this.createFromPackage(pkg, ownerUserId, {
            includeResponses,
            pictures: new Map([...pictures].map(([id, bytes]) => [id, { bytes }])),
        });
    }
    // --- internals ---------------------------------------------------------
    /** The files of every picture the package references (missing files are skipped, the reference is dropped later). */
    async pictureBytes(pkg) {
        const ids = (0, media_rules_1.collectMediaIds)({
            headerImage: pkg.survey.settings?.headerImage,
            sections: pkg.sections,
        });
        const rows = ids.length ? await this.prisma.surveyMedia.findMany({ where: { id: { in: ids } } }) : [];
        const result = new Map();
        for (const row of rows) {
            const bytes = await this.media.readBytes(row);
            if (bytes)
                result.set(row.id, { bytes, mime: row.mime });
        }
        return result;
    }
    async buildPackage(surveyId, includeResponses) {
        const survey = await this.prisma.surveySurvey.findUnique({
            where: { id: surveyId },
            include: {
                sections: {
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        questions: {
                            orderBy: { orderIndex: 'asc' },
                            include: { options: { orderBy: { orderIndex: 'asc' } } },
                        },
                    },
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
                responseLimit: survey.responseLimit,
                settings: (0, survey_settings_1.normalizeSettings)(survey.settings),
            },
            sections: survey.sections.map((s) => ({
                id: s.id,
                orderIndex: s.orderIndex,
                title: s.title,
                description: s.description ?? undefined,
                navigation: (s.navigation ?? {}),
                image: (s.image ?? null),
                questions: s.questions.map((q) => ({
                    id: q.id,
                    orderIndex: q.orderIndex,
                    type: q.type,
                    title: q.title,
                    description: q.description ?? undefined,
                    required: q.required,
                    config: (q.config ?? {}),
                    options: q.options.map((o) => ({
                        id: o.id,
                        orderIndex: o.orderIndex,
                        value: o.value,
                        label: o.label,
                    })),
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
                answers: r.answers.map((a) => ({
                    questionId: a.questionId,
                    value: a.value,
                })),
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
        const structure = (0, class_transformer_1.plainToInstance)(survey_structure_dto_1.SurveyStructureDto, {
            sections: obj.sections,
            logicRules: obj.logicRules ?? [],
        });
        const errors = (0, class_validator_1.validateSync)(structure, {
            whitelist: true,
            forbidUnknownValues: true,
        });
        if (errors.length > 0) {
            throw new common_1.BadRequestException('The survey structure in the file is invalid');
        }
        this.surveys.validateStructure(structure);
        return {
            ...obj,
            sections: structure.sections,
            logicRules: structure.logicRules ?? [],
        };
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
        const copiedFiles = [];
        try {
            return await this.prisma.$transaction(async (tx) => {
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
                        // An imported file is untrusted: re-check the cap and normalise the settings like a builder save.
                        responseLimit: (0, survey_settings_1.validateSurveyOptions)({
                            responseLimit: settings.responseLimit,
                        }) === null
                            ? (settings.responseLimit ?? null)
                            : null,
                        settings: (0, survey_settings_1.normalizeSettings)({
                            ...settings.settings,
                            headerImage: undefined,
                        }),
                    },
                });
                // Pictures are copied as new files owned by the new survey; a reference whose file is
                // missing from the package is dropped rather than left pointing at nothing.
                const mediaIds = new Map();
                for (const oldId of (0, media_rules_1.collectMediaIds)({
                    headerImage: settings.settings?.headerImage,
                    sections: pkg.sections,
                })) {
                    const picture = opts.pictures?.get(oldId);
                    if (!picture)
                        continue;
                    const copy = await this.media.insertCopy(tx, newSurveyId, picture.bytes, ownerUserId);
                    copiedFiles.push(copy);
                    mediaIds.set(oldId, copy.id);
                }
                const remapImage = (value) => {
                    const parsed = (0, question_rules_1.parseImageRef)(value);
                    const newId = 'ref' in parsed && parsed.ref ? mediaIds.get(parsed.ref.mediaId) : undefined;
                    return newId
                        ? {
                            mediaId: newId,
                            alt: parsed.ref.alt,
                        }
                        : null;
                };
                const header = remapImage(settings.settings?.headerImage);
                if (header) {
                    await tx.surveySurvey.update({
                        where: { id: newSurveyId },
                        data: {
                            settings: (0, survey_settings_1.normalizeSettings)({
                                ...(0, survey_settings_1.normalizeSettings)(settings.settings),
                                headerImage: header,
                            }),
                        },
                    });
                }
                for (const section of pkg.sections) {
                    await tx.surveySection.create({
                        data: {
                            id: sectionIds.get(section.id),
                            surveyId: newSurveyId,
                            orderIndex: section.orderIndex,
                            title: (0, piping_1.remapTokens)(section.title, questionIds) ?? section.title,
                            description: (0, piping_1.remapTokens)(section.description, questionIds),
                            navigation: this.remapNavigation(section.navigation, sectionIds, questionIds),
                            image: (remapImage(section.image) ?? client_1.Prisma.DbNull),
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
                                title: (0, piping_1.remapTokens)(question.title, questionIds) ?? question.title,
                                description: (0, piping_1.remapTokens)(question.description, questionIds),
                                required: question.required ?? false,
                                config: this.remapQuestionConfig(question.config, remapImage, questionIds),
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
                return tx.surveySurvey.findUniqueOrThrow({
                    where: { id: newSurveyId },
                });
            }, { timeout: 120_000 });
        }
        catch (err) {
            await this.media.removeFiles(copiedFiles);
            throw err;
        }
    }
    /** `config.image` is rewritten to the copied picture, or removed when its file is not available. */
    remapQuestionConfig(config, remapImage, questionIds) {
        const { image, optionsFrom, ...rest } = config ?? {};
        const mapped = image === undefined ? null : remapImage(image);
        // Carry-forward points at another question by id: follow it to the copy.
        const from = (0, piping_1.getOptionsFrom)({ config: { optionsFrom } });
        const carried = from ? { optionsFrom: { questionId: questionIds.get(from.questionId) ?? from.questionId, mode: from.mode } } : {};
        return {
            ...rest,
            ...carried,
            ...(mapped ? { image: mapped } : {}),
        };
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
                    return {
                        id,
                        surveyId,
                        respondentEmail: r.respondentEmail ?? null,
                        submittedAt,
                    };
                }),
            });
            const answers = rows.flatMap(({ id, r }) => (r.answers ?? [])
                .filter((a) => questionIds.has(a.questionId) && a.value !== null && a.value !== undefined)
                .map((a) => ({
                responseId: id,
                questionId: questionIds.get(a.questionId),
                value: (a.value ?? null),
            })));
            if (answers.length)
                await tx.surveyAnswer.createMany({
                    data: answers,
                    skipDuplicates: true,
                });
        }
    }
};
exports.SurveyTransferService = SurveyTransferService;
exports.SurveyTransferService = SurveyTransferService = SurveyTransferService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [surveys_service_1.SurveysService,
        media_service_1.SurveyMediaService])
], SurveyTransferService);
