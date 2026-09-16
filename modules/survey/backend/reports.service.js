"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ReportsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const SAMPLE_ANSWER_CAP = 200;
/**
 * The admin report/response-management surface (docs/BUILD_PLAN.md's own
 * implementation plan §"Backend — reports"): per-question aggregates
 * (`getSummary` — Google-Forms-style), a flattened one-row-per-response
 * dataset (`getDataset` — feeds the frontend's dynamic pivot table), an xlsx
 * export, and plain list/view/delete of individual responses. One service
 * because all five read from the exact same `survey_responses`/
 * `survey_answers` shape via the same dedicated `PrismaClient` — splitting
 * "reporting" from "response admin" here would just be two thin wrappers
 * around one query.
 */
let ReportsService = ReportsService_1 = class ReportsService {
    logger = new common_1.Logger(ReportsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('survey (reports) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async listResponses(surveyId) {
        await this.ensureSurveyExists(surveyId);
        const responses = await this.prisma.surveyResponse.findMany({
            where: { surveyId },
            orderBy: { submittedAt: 'desc' },
            select: { id: true, respondentUserId: true, respondentEmail: true, submittedAt: true, updatedAt: true, ipAddress: true, userAgent: true },
        });
        // `editTokenHash` is never selected at all here — no reason for it to
        // reach the admin UI even in hashed form (see SurveyResponse.editTokenHash's
        // own `/// @Sensitive` marker in schema.prisma).
        return responses;
    }
    async getResponse(surveyId, responseId) {
        await this.ensureSurveyExists(surveyId);
        const response = await this.prisma.surveyResponse.findUnique({
            where: { id: responseId },
            include: { answers: true },
        });
        if (!response || response.surveyId !== surveyId) {
            throw new common_1.NotFoundException('Response not found');
        }
        const { editTokenHash: _editTokenHash, ...safe } = response;
        return safe;
    }
    async removeResponse(surveyId, responseId) {
        const response = await this.prisma.surveyResponse.findUnique({ where: { id: responseId } });
        if (!response || response.surveyId !== surveyId) {
            throw new common_1.NotFoundException('Response not found');
        }
        await this.prisma.surveyResponse.delete({ where: { id: responseId } });
    }
    async getSummary(surveyId) {
        const { questions, responses } = await this.loadSurveyWithAnswers(surveyId);
        const questions_ = questions.map((q) => {
            const values = responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id).map((a) => a.value));
            const base = { questionId: q.id, title: q.title, type: q.type, totalAnswered: values.length };
            if (q.type === 'single_choice' || q.type === 'dropdown' || q.type === 'multi_choice') {
                const counts = new Map();
                for (const value of values) {
                    const selected = Array.isArray(value) ? value : [value];
                    for (const v of selected) {
                        if (typeof v === 'string')
                            counts.set(v, (counts.get(v) ?? 0) + 1);
                    }
                }
                return { ...base, optionCounts: q.options.map((o) => ({ value: o.value, label: o.label, count: counts.get(o.value) ?? 0 })) };
            }
            if (q.type === 'linear_scale' || q.type === 'rating') {
                const numbers = values.filter((v) => typeof v === 'number');
                const distMap = new Map();
                for (const n of numbers)
                    distMap.set(n, (distMap.get(n) ?? 0) + 1);
                const distribution = [...distMap.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count }));
                const average = numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
                return {
                    ...base,
                    numeric: { average, min: numbers.length ? Math.min(...numbers) : 0, max: numbers.length ? Math.max(...numbers) : 0, distribution },
                };
            }
            // short_text / paragraph / date / time — nothing to aggregate, a
            // capped raw list is the whole "summary" (matches Google Forms'
            // own "individual responses" fallback for free-text questions).
            return { ...base, sampleAnswers: values.filter((v) => typeof v === 'string').slice(0, SAMPLE_ANSWER_CAP) };
        });
        return { surveyId, totalResponses: responses.length, questions: questions_ };
    }
    /** One row per response, one column per question — feeds the frontend's dynamic pivot table. */
    async getDataset(surveyId) {
        const { questions, responses } = await this.loadSurveyWithAnswers(surveyId);
        return {
            columns: questions.map((q) => ({ questionId: q.id, title: q.title, type: q.type })),
            rows: responses.map((r) => ({
                responseId: r.id,
                submittedAt: r.submittedAt,
                respondentLabel: r.respondentEmail ?? 'Anonymous',
                answers: Object.fromEntries(r.answers.map((a) => [a.questionId, a.value])),
            })),
        };
    }
    async exportResponsesWorkbook(surveyId) {
        const { survey, questions, responses } = await this.loadSurveyWithAnswers(surveyId);
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Responses');
        worksheet.columns = [
            { header: 'response_id', key: 'responseId', width: 36 },
            { header: 'submitted_at', key: 'submittedAt', width: 22 },
            { header: 'respondent', key: 'respondent', width: 28 },
            ...questions.map((q) => ({ header: q.title, key: q.id, width: 24 })),
        ];
        for (const r of responses) {
            const row = {
                responseId: r.id,
                submittedAt: r.submittedAt.toISOString(),
                respondent: r.respondentEmail ?? 'Anonymous',
            };
            for (const a of r.answers) {
                row[a.questionId] = Array.isArray(a.value) ? a.value.join(', ') : (a.value ?? '');
            }
            worksheet.addRow(row);
        }
        void survey; // only needed above for its sections->questions shape
        return workbook.xlsx.writeBuffer();
    }
    // --- internals -------------------------------------------------------
    async ensureSurveyExists(surveyId) {
        const exists = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { id: true } });
        if (!exists) {
            throw new common_1.NotFoundException('Survey not found');
        }
    }
    async loadSurveyWithAnswers(surveyId) {
        const survey = await this.prisma.surveySurvey.findUnique({
            where: { id: surveyId },
            include: {
                sections: {
                    orderBy: { orderIndex: 'asc' },
                    include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } },
                },
            },
        });
        if (!survey) {
            throw new common_1.NotFoundException('Survey not found');
        }
        const questions = survey.sections.flatMap((s) => s.questions);
        const responses = await this.prisma.surveyResponse.findMany({
            where: { surveyId },
            include: { answers: { select: { questionId: true, value: true } } },
            orderBy: { submittedAt: 'desc' },
        });
        return { survey, questions, responses };
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = ReportsService_1 = __decorate([
    (0, common_1.Injectable)()
], ReportsService);
