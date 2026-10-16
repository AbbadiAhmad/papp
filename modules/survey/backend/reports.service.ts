import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient, SurveyQuestion, SurveyQuestionOption, SurveyResponse } from '@prisma/client';
import ExcelJS from 'exceljs';
import { answerForDisplay, formatAnswerForDisplay, summarizeChoiceAnswers } from './question-rules';
import { getOptionsFrom } from './piping';
import { dailyAverages, dailyCounts, EMPTY_FILTER, FILTERABLE_TYPES, parseReportFilter, type AveragePoint, type DailyPoint, type ReportFilter, type ReportFilterQuery } from './report-filter';

type QuestionWithOptions = SurveyQuestion & { options: SurveyQuestionOption[] };
type ResponseWithAnswers = SurveyResponse & { answers: Array<{ questionId: string; value: Prisma.JsonValue }> };

export interface QuestionSummary {
  questionId: string;
  title: string;
  type: string;
  totalAnswered: number;
  /** single_choice / multi_choice / dropdown only. */
  optionCounts?: Array<{ value: string; label: string; count: number }>;
  /** Texts typed into an "Other" choice (capped), when the question allows it. */
  otherAnswers?: string[];
  /** linear_scale / rating only. */
  numeric?: { average: number; min: number; max: number; distribution: Array<{ value: number; count: number }>; trend: AveragePoint[] };
  /** short_text / paragraph / date / time only — raw list, capped. */
  sampleAnswers?: string[];
}

export interface SurveyReportSummary {
  surveyId: string;
  totalResponses: number;
  /** Responses per day (UTC) within the filter — the trend line. */
  daily: DailyPoint[];
  questions: QuestionSummary[];
}

export interface SurveyDataset {
  columns: Array<{ questionId: string; title: string; type: string }>;
  rows: Array<{ responseId: string; submittedAt: Date; respondentLabel: string; answers: Record<string, Prisma.JsonValue> }>;
}

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
@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('survey (reports) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Parses `from` / `to` / `a` from a request; 400 with a plain message when they are malformed. */
  parseFilter(query: ReportFilterQuery): ReportFilter {
    const parsed = parseReportFilter(query);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    return parsed.filter;
  }

  /** The Prisma condition for a filter on one survey's responses; every condition must hold. */
  private async whereFor(surveyId: string, filter: ReportFilter): Promise<Prisma.SurveyResponseWhereInput> {
    const where: Prisma.SurveyResponseWhereInput = { surveyId };
    if (filter.from || filter.toExclusive) {
      where.submittedAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.toExclusive ? { lt: filter.toExclusive } : {}) };
    }
    if (filter.answers.length > 0) {
      const questions = await this.prisma.surveyQuestion.findMany({ where: { id: { in: filter.answers.map((c) => c.questionId) }, section: { surveyId } }, select: { id: true, type: true } });
      const typeOf = new Map(questions.map((q) => [q.id, q.type as string]));
      where.AND = filter.answers.map((condition) => {
        const type = typeOf.get(condition.questionId);
        if (!type) throw new BadRequestException('A filter refers to a question that is not in this survey');
        if (!(FILTERABLE_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Responses can be filtered by choice, scale and rating questions only');
        if (type === 'linear_scale' || type === 'rating') {
          const n = Number(condition.value);
          if (!Number.isFinite(n)) throw new BadRequestException('A scale or rating filter needs a number');
          return { answers: { some: { questionId: condition.questionId, value: { equals: n } } } };
        }
        return {
          answers: {
            some: {
              questionId: condition.questionId,
              // single choice stores a string, multiple choice an array of strings
              OR: [{ value: { equals: condition.value } }, { value: { array_contains: [condition.value] } }],
            },
          },
        };
      });
    }
    return where;
  }

  async listResponses(surveyId: string, filter: ReportFilter = EMPTY_FILTER) {
    await this.ensureSurveyExists(surveyId);
    const responses = await this.prisma.surveyResponse.findMany({
      where: await this.whereFor(surveyId, filter),
      orderBy: { submittedAt: 'desc' },
      select: { id: true, respondentUserId: true, respondentEmail: true, submittedAt: true, updatedAt: true, ipAddress: true, userAgent: true },
    });
    // `editTokenHash` is never selected at all here — no reason for it to
    // reach the admin UI even in hashed form (see SurveyResponse.editTokenHash's
    // own `/// @Sensitive` marker in schema.prisma).
    return responses;
  }

  async getResponse(surveyId: string, responseId: string) {
    await this.ensureSurveyExists(surveyId);
    const response = await this.prisma.surveyResponse.findUnique({
      where: { id: responseId },
      include: { answers: true },
    });
    if (!response || response.surveyId !== surveyId) {
      throw new NotFoundException('Response not found');
    }
    const { editTokenHash: _editTokenHash, ...safe } = response;
    return safe;
  }

  async removeResponse(surveyId: string, responseId: string): Promise<void> {
    const response = await this.prisma.surveyResponse.findUnique({ where: { id: responseId } });
    if (!response || response.surveyId !== surveyId) {
      throw new NotFoundException('Response not found');
    }
    await this.prisma.surveyResponse.delete({ where: { id: responseId } });
  }

  async getSummary(surveyId: string, filter: ReportFilter = EMPTY_FILTER): Promise<SurveyReportSummary> {
    const { questions, responses } = await this.loadSurveyWithAnswers(surveyId, filter);

    const questions_ = questions.map((q): QuestionSummary => {
      const values = responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id).map((a) => a.value));
      const base = { questionId: q.id, title: q.title, type: q.type as string, totalAnswered: values.length };

      if (q.type === 'single_choice' || q.type === 'dropdown' || q.type === 'multi_choice') {
        // A question that takes its choices from an earlier one is reported against all of that question's options.
        const from = getOptionsFrom({ config: q.config as Record<string, unknown> | null });
        const sourceOptions = from ? questions.find((x) => x.id === from.questionId)?.options : undefined;
        const { optionCounts, otherAnswers } = summarizeChoiceAnswers(sourceOptions ?? q.options, values, q.config);
        return { ...base, optionCounts, ...(otherAnswers.length ? { otherAnswers } : {}) };
      }

      if (q.type === 'linear_scale' || q.type === 'rating') {
        const numbers = values.filter((v): v is number => typeof v === 'number');
        const distMap = new Map<number, number>();
        for (const n of numbers) distMap.set(n, (distMap.get(n) ?? 0) + 1);
        const distribution = [...distMap.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count }));
        const trend = dailyAverages(
          responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id && typeof a.value === 'number').map((a) => ({ at: r.submittedAt, value: a.value as number }))),
        );
        const average = numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
        return {
          ...base,
          numeric: { average, min: numbers.length ? Math.min(...numbers) : 0, max: numbers.length ? Math.max(...numbers) : 0, distribution, trend },
        };
      }

      // short_text / paragraph / date / time — nothing to aggregate, a
      // capped raw list is the whole "summary" (matches Google Forms'
      // own "individual responses" fallback for free-text questions).
      return { ...base, sampleAnswers: values.filter((v): v is string => typeof v === 'string').slice(0, SAMPLE_ANSWER_CAP) };
    });

    return { surveyId, totalResponses: responses.length, daily: dailyCounts(responses.map((r) => r.submittedAt)), questions: questions_ };
  }

  /** One row per response, one column per question — feeds the frontend's dynamic pivot table. */
  async getDataset(surveyId: string, filter: ReportFilter = EMPTY_FILTER): Promise<SurveyDataset> {
    const { questions, responses } = await this.loadSurveyWithAnswers(surveyId, filter);
    return {
      columns: questions.map((q) => ({ questionId: q.id, title: q.title, type: q.type as string })),
      rows: responses.map((r) => ({
        responseId: r.id,
        submittedAt: r.submittedAt,
        respondentLabel: r.respondentEmail ?? 'Anonymous',
        answers: Object.fromEntries(r.answers.map((a) => [a.questionId, answerForDisplay(a.value) as Prisma.JsonValue])),
      })),
    };
  }

  async exportResponsesWorkbook(surveyId: string, filter: ReportFilter = EMPTY_FILTER): Promise<Buffer> {
    const { survey, questions, responses } = await this.loadSurveyWithAnswers(surveyId, filter);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Responses');
    worksheet.columns = [
      { header: 'response_id', key: 'responseId', width: 36 },
      { header: 'submitted_at', key: 'submittedAt', width: 22 },
      { header: 'respondent', key: 'respondent', width: 28 },
      ...questions.map((q) => ({ header: q.title, key: q.id, width: 24 })),
    ];
    for (const r of responses) {
      const row: Record<string, unknown> = {
        responseId: r.id,
        submittedAt: r.submittedAt.toISOString(),
        respondent: r.respondentEmail ?? 'Anonymous',
      };
      for (const a of r.answers) {
        row[a.questionId] = a.value === null || a.value === undefined ? '' : Array.isArray(a.value) || typeof a.value === 'string' ? formatAnswerForDisplay(a.value) : a.value;
      }
      worksheet.addRow(row);
    }
    void survey; // only needed above for its sections->questions shape
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // --- internals -------------------------------------------------------

  private async ensureSurveyExists(surveyId: string): Promise<void> {
    const exists = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException('Survey not found');
    }
  }

  private async loadSurveyWithAnswers(surveyId: string, filter: ReportFilter = EMPTY_FILTER): Promise<{
    survey: { id: string };
    questions: QuestionWithOptions[];
    responses: ResponseWithAnswers[];
  }> {
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
      throw new NotFoundException('Survey not found');
    }
    const questions = survey.sections.flatMap((s) => s.questions);
    const responses = await this.prisma.surveyResponse.findMany({
      where: await this.whereFor(surveyId, filter),
      include: { answers: { select: { questionId: true, value: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    return { survey, questions, responses };
  }
}
