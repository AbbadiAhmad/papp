import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import { SurveyStructureDto } from './dto/survey-structure.dto';
import { SurveysService } from './surveys.service';

export const SURVEY_PACKAGE_FORMAT = 'papp.survey.package';
export const SURVEY_PACKAGE_VERSION = 1;
const PACKAGE_ENTRY = 'survey.json';
/** Guards against a zip bomb: the unzipped survey.json may not exceed this. */
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const INSERT_BATCH = 1000;

interface PackageSettings {
  title: string;
  description: string | null;
  requiresLogin: boolean;
  allowEditAfterSubmit: boolean;
  oneResponsePerRespondent: boolean;
  notifyOwnerOnSubmit: boolean;
  notifyEmails: string[];
  opensAt: string | null;
  closesAt: string | null;
  closedMessage: string | null;
}

interface PackageResponse {
  submittedAt: string;
  respondentEmail: string | null;
  answers: Array<{ questionId: string; value: unknown }>;
}

/**
 * The portable survey file: `survey.json` inside a zip. Ids inside the file
 * are only references between its own parts — every import (and duplicate)
 * mints fresh UUIDs, so importing the same file twice, or into the instance
 * it came from, never collides. Responses are portable only as data
 * (submission time, respondent email, answers); the respondent's user id,
 * edit token, IP and user agent are deliberately NOT exported.
 */
export interface SurveyPackage {
  format: typeof SURVEY_PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  includesResponses: boolean;
  survey: PackageSettings;
  sections: SurveyStructureDto['sections'];
  logicRules: NonNullable<SurveyStructureDto['logicRules']>;
  responses?: PackageResponse[];
}

@Injectable()
export class SurveyTransferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SurveyTransferService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly surveys: SurveysService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('survey transfer Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- export ------------------------------------------------------------

  async exportZip(surveyId: string, includeResponses: boolean): Promise<{ buffer: Buffer; filename: string }> {
    const pkg = await this.buildPackage(surveyId, includeResponses);
    const zip = new JSZip();
    zip.file(PACKAGE_ENTRY, JSON.stringify(pkg, null, 2));
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const safeTitle = pkg.survey.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'survey';
    return { buffer, filename: `${safeTitle}${includeResponses ? '-with-responses' : ''}.zip` };
  }

  // --- duplicate ---------------------------------------------------------

  /** Copies a survey of ANY status (archived and closed included) into a brand-new draft; responses are never copied. */
  async duplicate(surveyId: string, ownerUserId: string, title?: string) {
    const pkg = await this.buildPackage(surveyId, false);
    const name = title?.trim() || `${pkg.survey.title} (copy)`;
    return this.createFromPackage(pkg, ownerUserId, { title: name, includeResponses: false });
  }

  // --- import ------------------------------------------------------------

  async importZip(buffer: Buffer, ownerUserId: string, includeResponses: boolean) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new BadRequestException('The uploaded file is not a valid zip archive');
    }
    const entry = zip.file(PACKAGE_ENTRY);
    if (!entry) {
      throw new BadRequestException(`The archive does not contain ${PACKAGE_ENTRY}`);
    }
    const raw = await entry.async('string');
    if (raw.length > MAX_UNZIPPED_BYTES) {
      throw new BadRequestException('The survey file is too large');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException(`${PACKAGE_ENTRY} is not valid JSON`);
    }
    const pkg = this.validatePackage(parsed);
    return this.createFromPackage(pkg, ownerUserId, { includeResponses });
  }

  // --- internals ---------------------------------------------------------

  private async buildPackage(surveyId: string, includeResponses: boolean): Promise<SurveyPackage> {
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
    if (!survey) throw new NotFoundException('Survey not found');

    const pkg: SurveyPackage = {
      format: SURVEY_PACKAGE_FORMAT,
      version: SURVEY_PACKAGE_VERSION,
      exportedAt: new Date().toISOString(),
      includesResponses: includeResponses,
      survey: {
        title: survey.title,
        description: survey.description,
        requiresLogin: survey.requiresLogin,
        allowEditAfterSubmit: survey.allowEditAfterSubmit,
        oneResponsePerRespondent: survey.oneResponsePerRespondent,
        notifyOwnerOnSubmit: survey.notifyOwnerOnSubmit,
        notifyEmails: Array.isArray(survey.notifyEmails) ? (survey.notifyEmails as string[]) : [],
        opensAt: survey.opensAt?.toISOString() ?? null,
        closesAt: survey.closesAt?.toISOString() ?? null,
        closedMessage: survey.closedMessage,
      },
      sections: survey.sections.map((s) => ({
        id: s.id,
        orderIndex: s.orderIndex,
        title: s.title,
        description: s.description ?? undefined,
        navigation: (s.navigation ?? {}) as SurveyStructureDto['sections'][number]['navigation'],
        questions: s.questions.map((q) => ({
          id: q.id,
          orderIndex: q.orderIndex,
          type: q.type,
          title: q.title,
          description: q.description ?? undefined,
          required: q.required,
          config: (q.config ?? {}) as Record<string, unknown>,
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
      const withAnswers = (survey.responses ?? []) as unknown as Array<{
        submittedAt: Date;
        respondentEmail: string | null;
        answers: Array<{ questionId: string; value: Prisma.JsonValue }>;
      }>;
      pkg.responses = withAnswers.map((r) => ({
        submittedAt: r.submittedAt.toISOString(),
        respondentEmail: r.respondentEmail,
        answers: r.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
      }));
    }
    return pkg;
  }

  /** Never trust an uploaded file: structurally validate it exactly like a builder save. */
  private validatePackage(parsed: unknown): SurveyPackage {
    const obj = parsed as Partial<SurveyPackage> | null;
    if (!obj || typeof obj !== 'object' || obj.format !== SURVEY_PACKAGE_FORMAT) {
      throw new BadRequestException('This is not a survey package file');
    }
    if (typeof obj.version !== 'number' || obj.version > SURVEY_PACKAGE_VERSION) {
      throw new BadRequestException(`Unsupported survey package version: ${String(obj.version)}`);
    }
    const settings = obj.survey;
    if (!settings || typeof settings.title !== 'string' || !settings.title.trim()) {
      throw new BadRequestException('The survey package has no title');
    }
    const structure = plainToInstance(SurveyStructureDto, { sections: obj.sections, logicRules: obj.logicRules ?? [] });
    const errors = validateSync(structure, { whitelist: true, forbidUnknownValues: true });
    if (errors.length > 0) {
      throw new BadRequestException('The survey structure in the file is invalid');
    }
    this.surveys.validateStructure(structure);
    return { ...(obj as SurveyPackage), sections: structure.sections, logicRules: structure.logicRules ?? [] };
  }

  private async createFromPackage(pkg: SurveyPackage, ownerUserId: string, opts: { title?: string; includeResponses: boolean }) {
    const sectionIds = new Map<string, string>();
    const questionIds = new Map<string, string>();
    for (const section of pkg.sections) {
      sectionIds.set(section.id, randomUUID());
      for (const question of section.questions) questionIds.set(question.id, randomUUID());
    }
    const settings = pkg.survey;
    const newSurveyId = randomUUID();

    return this.prisma.$transaction(
      async (tx) => {
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
            notifyEmails: (settings.notifyEmails ?? []) as unknown as Prisma.InputJsonValue,
            opensAt: settings.opensAt ? new Date(settings.opensAt) : null,
            closesAt: settings.closesAt ? new Date(settings.closesAt) : null,
            closedMessage: settings.closedMessage ?? null,
          },
        });

        for (const section of pkg.sections) {
          await tx.surveySection.create({
            data: {
              id: sectionIds.get(section.id)!,
              surveyId: newSurveyId,
              orderIndex: section.orderIndex,
              title: section.title,
              description: section.description,
              navigation: this.remapNavigation(section.navigation, sectionIds, questionIds),
            },
          });
          for (const question of section.questions) {
            const newQuestionId = questionIds.get(question.id)!;
            await tx.surveyQuestion.create({
              data: {
                id: newQuestionId,
                sectionId: sectionIds.get(section.id)!,
                orderIndex: question.orderIndex,
                type: question.type,
                title: question.title,
                description: question.description,
                required: question.required ?? false,
                config: (question.config ?? {}) as Prisma.InputJsonValue,
              },
            });
            if (question.options?.length) {
              await tx.surveyQuestionOption.createMany({
                data: question.options.map((o) => ({
                  id: randomUUID(),
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
              sourceQuestionId: questionIds.get(r.sourceQuestionId)!,
              sourceOptionValue: r.sourceOptionValue,
              action: r.action,
              targetType: r.targetType,
              targetId: (r.targetType === 'section' ? sectionIds : questionIds).get(r.targetId)!,
              orderIndex: r.orderIndex,
            })),
          });
        }

        if (opts.includeResponses && pkg.responses?.length) {
          await this.insertResponses(tx, newSurveyId, pkg.responses, questionIds);
        }

        return tx.surveySurvey.findUniqueOrThrow({ where: { id: newSurveyId } });
      },
      { timeout: 120_000 },
    );
  }

  /** Section ids / question ids inside the navigation JSON are rewritten to the freshly minted ones. */
  private remapNavigation(
    nav: SurveyStructureDto['sections'][number]['navigation'],
    sectionIds: Map<string, string>,
    questionIds: Map<string, string>,
  ): Prisma.InputJsonValue {
    const mapTarget = (target: string) => (target === 'submit' ? target : (sectionIds.get(target) ?? target));
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

  private async insertResponses(
    tx: Prisma.TransactionClient,
    surveyId: string,
    responses: PackageResponse[],
    questionIds: Map<string, string>,
  ): Promise<void> {
    for (let start = 0; start < responses.length; start += INSERT_BATCH) {
      const batch = responses.slice(start, start + INSERT_BATCH);
      const rows = batch.map((r) => ({ id: randomUUID(), r }));
      await tx.surveyResponse.createMany({
        data: rows.map(({ id, r }) => {
          const submittedAt = new Date(r.submittedAt);
          if (Number.isNaN(submittedAt.getTime())) throw new BadRequestException('A response in the file has an invalid submittedAt');
          return { id, surveyId, respondentEmail: r.respondentEmail ?? null, submittedAt };
        }),
      });
      const answers = rows.flatMap(({ id, r }) =>
        (r.answers ?? [])
          .filter((a) => questionIds.has(a.questionId) && a.value !== null && a.value !== undefined)
          .map((a) => ({ responseId: id, questionId: questionIds.get(a.questionId)!, value: (a.value ?? null) as Prisma.InputJsonValue })),
      );
      if (answers.length) await tx.surveyAnswer.createMany({ data: answers, skipDuplicates: true });
    }
  }
}
