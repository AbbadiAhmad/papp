"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SurveyMediaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyMediaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const media_rules_1 = require("./media-rules");
/** Pictures not referenced by the survey are kept this long (an upload happens before the Save click). */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
/**
 * Stores survey pictures in a disk volume (SURVEY-D18). Files are named `<media id>.<ext>`; the
 * `survey_media` row is the ownership/type record, so a file name or type is never taken from the
 * request. Real `PrismaClient`, same module-boundary reason as SurveysService.
 */
let SurveyMediaService = SurveyMediaService_1 = class SurveyMediaService {
    logger = new common_1.Logger(SurveyMediaService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    /** Read on every call so a deployment (and a test) can point it elsewhere. */
    directory() {
        return process.env.SURVEY_MEDIA_DIR || (0, path_1.join)(process.cwd(), 'data', 'survey-media');
    }
    fileFor(id, mime) {
        return (0, path_1.join)(this.directory(), `${id}.${(0, media_rules_1.extensionForMime)(mime)}`);
    }
    async upload(surveyId, bytes, userId) {
        const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { id: true } });
        if (!survey)
            throw new common_1.NotFoundException('Survey not found');
        const checked = (0, media_rules_1.validateImageUpload)(bytes);
        if ('error' in checked)
            throw new common_1.BadRequestException(checked.error);
        const count = await this.prisma.surveyMedia.count({ where: { surveyId } });
        if (count >= media_rules_1.MAX_IMAGES_PER_SURVEY) {
            throw new common_1.BadRequestException(`A survey can hold at most ${media_rules_1.MAX_IMAGES_PER_SURVEY} images`);
        }
        const id = (0, crypto_1.randomUUID)();
        await fs_1.promises.mkdir(this.directory(), { recursive: true });
        await fs_1.promises.writeFile(this.fileFor(id, checked.mime), bytes);
        try {
            await this.prisma.surveyMedia.create({ data: { id, surveyId, mime: checked.mime, sizeBytes: bytes.length, createdBy: userId } });
        }
        catch (err) {
            await fs_1.promises.rm(this.fileFor(id, checked.mime), { force: true });
            throw err;
        }
        return { mediaId: id, mime: checked.mime, sizeBytes: bytes.length };
    }
    /** For the public image route: where the file is and its type, from the DB row only. */
    async locate(id) {
        const row = await this.prisma.surveyMedia.findUnique({ where: { id } });
        return row ? { path: this.fileFor(row.id, row.mime), mime: row.mime } : null;
    }
    /** Rejects a save that references a picture belonging to another survey (or none at all). */
    async assertOwned(surveyId, ids) {
        if (ids.length === 0)
            return;
        const found = await this.prisma.surveyMedia.count({ where: { surveyId, id: { in: ids } } });
        if (found !== ids.length)
            throw new common_1.BadRequestException('An image used in this survey was not found; upload it again');
    }
    /** Deletes this survey's pictures that nothing references any more (and are not brand new). */
    async collectGarbage(surveyId) {
        try {
            const survey = await this.prisma.surveySurvey.findUnique({
                where: { id: surveyId },
                include: { sections: { include: { questions: { select: { config: true } } } } },
            });
            if (!survey)
                return;
            const settings = (survey.settings ?? {});
            const referenced = new Set((0, media_rules_1.collectMediaIds)({
                headerImage: settings.headerImage,
                sections: survey.sections.map((s) => ({
                    image: s.image,
                    questions: s.questions.map((q) => ({ config: (q.config ?? {}) })),
                })),
            }));
            const rows = await this.prisma.surveyMedia.findMany({
                where: { surveyId, createdAt: { lt: new Date(Date.now() - ORPHAN_GRACE_MS) } },
            });
            for (const row of rows.filter((r) => !referenced.has(r.id))) {
                await this.prisma.surveyMedia.delete({ where: { id: row.id } });
                await fs_1.promises.rm(this.fileFor(row.id, row.mime), { force: true });
            }
        }
        catch (err) {
            // Cleanup must never fail the save that triggered it.
            this.logger.warn(`image cleanup failed: ${err.message}`);
        }
    }
    /** Lists a survey's pictures (id + type), used before deleting a survey so the files can follow. */
    async listFor(surveyId) {
        return this.prisma.surveyMedia.findMany({ where: { surveyId } });
    }
    async removeFiles(rows) {
        for (const row of rows)
            await fs_1.promises.rm(this.fileFor(row.id, row.mime), { force: true });
    }
    async readBytes(row) {
        try {
            return await fs_1.promises.readFile(this.fileFor(row.id, row.mime));
        }
        catch {
            return null;
        }
    }
    /**
     * Writes already-validated bytes as a new picture of `surveyId` (import / duplicate). The row is
     * created through `tx` so it commits or rolls back with the new survey; the caller removes the
     * returned files if the transaction fails.
     */
    async insertCopy(tx, surveyId, bytes, createdBy) {
        const checked = (0, media_rules_1.validateImageUpload)(bytes);
        if ('error' in checked)
            throw new common_1.BadRequestException(checked.error);
        const id = (0, crypto_1.randomUUID)();
        await fs_1.promises.mkdir(this.directory(), { recursive: true });
        await fs_1.promises.writeFile(this.fileFor(id, checked.mime), bytes);
        await tx.surveyMedia.create({ data: { id, surveyId, mime: checked.mime, sizeBytes: bytes.length, createdBy } });
        return { id, mime: checked.mime };
    }
};
exports.SurveyMediaService = SurveyMediaService;
exports.SurveyMediaService = SurveyMediaService = SurveyMediaService_1 = __decorate([
    (0, common_1.Injectable)()
], SurveyMediaService);
