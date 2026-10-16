import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import { SurveyStructureDto } from './dto/survey-structure.dto';
import { SurveyMediaService } from './media.service';
import { collectMediaIds, extensionForMime, ImageMime, MAX_IMAGE_BYTES, MAX_IMAGES_PER_SURVEY } from './media-rules';
import { parseImageRef } from './question-rules';
import { normalizeSettings, validateSurveyOptions } from './survey-settings';
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
  /** Added with phase C; absent in packages exported by older versions (treated as no cap / default settings). */
  responseLimit?: number | null;
  settings?: Record<string, unknown>;
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

  constructor(
    private readonly surveys: SurveysService,
    private readonly media: SurveyMediaService,
  ) {}

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
    for (const [id, picture] of await this.pictureBytes(pkg)) {
      zip.file(`media/${id}.${extensionForMime(picture.mime)}`, picture.bytes);
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
  async duplicate(surveyId: string, ownerUserId: string, title?: string) {
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
    const pictures = new Map<string, Uint8Array>();
    for (const [name, file] of Object.entries(zip.files)) {
      const match = /^media\/([0-9a-f-]{36})\.(png|jpg|webp)$/i.exec(name);
      if (!match || file.dir || pictures.size >= MAX_IMAGES_PER_SURVEY) continue;
      const bytes = await file.async('uint8array');
      if (bytes.length <= MAX_IMAGE_BYTES) pictures.set(match[1].toLowerCase(), bytes);
    }
    return this.createFromPackage(pkg, ownerUserId, {
      includeResponses,
      pictures: new Map([...pictures].map(([id, bytes]) => [id, { bytes }])),
    });
  }

  // --- internals ---------------------------------------------------------

  /** The files of every picture the package references (missing files are skipped, the reference is dropped later). */
  private async pictureBytes(pkg: SurveyPackage): Promise<Map<string, { bytes: Uint8Array; mime: ImageMime }>> {
    const ids = collectMediaIds({
      headerImage: pkg.survey.settings?.headerImage,
      sections: pkg.sections,
    });
    const rows = ids.length ? await this.prisma.surveyMedia.findMany({ where: { id: { in: ids } } }) : [];
    const result = new Map<string, { bytes: Uint8Array; mime: ImageMime }>();
    for (const row of rows) {
      const bytes = await this.media.readBytes(row);
      if (bytes) result.set(row.id, { bytes, mime: row.mime as ImageMime });
    }
    return result;
  }

  private async buildPackage(surveyId: string, includeResponses: boolean): Promise<SurveyPackage> {
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
        responseLimit: survey.responseLimit,
        settings: normalizeSettings(survey.settings) as Record<string, unknown>,
      },
      sections: survey.sections.map((s) => ({
        id: s.id,
        orderIndex: s.orderIndex,
        title: s.title,
        description: s.description ?? undefined,
        navigation: (s.navigation ?? {}) as SurveyStructureDto['sections'][number]['navigation'],
        image: (s.image ?? null) as SurveyStructureDto['sections'][number]['image'],
        questions: s.questions.map((q) => ({
          id: q.id,
          orderIndex: q.orderIndex,
          type: q.type,
          title: q.title,
          description: q.description ?? undefined,
          required: q.required,
          config: (q.config ?? {}) as Record<string, unknown>,
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
      const withAnswers = (survey.responses ?? []) as unknown as Array<{
        submittedAt: Date;
        respondentEmail: string | null;
        answers: Array<{ questionId: string; value: Prisma.JsonValue }>;
      }>;
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
    const structure = plainToInstance(SurveyStructureDto, {
      sections: obj.sections,
      logicRules: obj.logicRules ?? [],
    });
    const errors = validateSync(structure, {
      whitelist: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException('The survey structure in the file is invalid');
    }
    this.surveys.validateStructure(structure);
    return {
      ...(obj as SurveyPackage),
      sections: structure.sections,
      logicRules: structure.logicRules ?? [],
    };
  }

  private async createFromPackage(
    pkg: SurveyPackage,
    ownerUserId: string,
    opts: {
      title?: string;
      includeResponses: boolean;
      pictures?: Map<string, { bytes: Uint8Array }>;
    },
  ) {
    const sectionIds = new Map<string, string>();
    const questionIds = new Map<string, string>();
    for (const section of pkg.sections) {
      sectionIds.set(section.id, randomUUID());
      for (const question of section.questions) questionIds.set(question.id, randomUUID());
    }
    const settings = pkg.survey;
    const newSurveyId = randomUUID();
    const copiedFiles: Array<{ id: string; mime: string }> = [];

    try {
      return await this.prisma.$transaction(
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
              // An imported file is untrusted: re-check the cap and normalise the settings like a builder save.
              responseLimit:
                validateSurveyOptions({
                  responseLimit: settings.responseLimit,
                }) === null
                  ? (settings.responseLimit ?? null)
                  : null,
              settings: normalizeSettings({
                ...settings.settings,
                headerImage: undefined,
              }) as Prisma.InputJsonValue,
            },
          });

          // Pictures are copied as new files owned by the new survey; a reference whose file is
          // missing from the package is dropped rather than left pointing at nothing.
          const mediaIds = new Map<string, string>();
          for (const oldId of collectMediaIds({
            headerImage: settings.settings?.headerImage,
            sections: pkg.sections,
          })) {
            const picture = opts.pictures?.get(oldId);
            if (!picture) continue;
            const copy = await this.media.insertCopy(tx, newSurveyId, picture.bytes, ownerUserId);
            copiedFiles.push(copy);
            mediaIds.set(oldId, copy.id);
          }
          const remapImage = (value: unknown) => {
            const parsed = parseImageRef(value);
            const newId = 'ref' in parsed && parsed.ref ? mediaIds.get(parsed.ref.mediaId) : undefined;
            return newId
              ? {
                  mediaId: newId,
                  alt: (parsed as { ref: { alt: string } }).ref.alt,
                }
              : null;
          };
          const header = remapImage(settings.settings?.headerImage);
          if (header) {
            await tx.surveySurvey.update({
              where: { id: newSurveyId },
              data: {
                settings: normalizeSettings({
                  ...normalizeSettings(settings.settings),
                  headerImage: header,
                }) as Prisma.InputJsonValue,
              },
            });
          }

          for (const section of pkg.sections) {
            await tx.surveySection.create({
              data: {
                id: sectionIds.get(section.id)!,
                surveyId: newSurveyId,
                orderIndex: section.orderIndex,
                title: section.title,
                description: section.description,
                navigation: this.remapNavigation(section.navigation, sectionIds, questionIds),
                image: (remapImage(section.image) ?? Prisma.DbNull) as Prisma.InputJsonValue,
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
                  config: this.remapQuestionConfig(question.config, remapImage),
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

          return tx.surveySurvey.findUniqueOrThrow({
            where: { id: newSurveyId },
          });
        },
        { timeout: 120_000 },
      );
    } catch (err) {
      await this.media.removeFiles(copiedFiles);
      throw err;
    }
  }

  /** `config.image` is rewritten to the copied picture, or removed when its file is not available. */
  private remapQuestionConfig(
    config: Record<string, unknown> | undefined,
    remapImage: (value: unknown) => { mediaId: string; alt: string } | null,
  ): Prisma.InputJsonValue {
    const { image, ...rest } = config ?? {};
    const mapped = image === undefined ? null : remapImage(image);
    return {
      ...rest,
      ...(mapped ? { image: mapped } : {}),
    } as Prisma.InputJsonValue;
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
          return {
            id,
            surveyId,
            respondentEmail: r.respondentEmail ?? null,
            submittedAt,
          };
        }),
      });
      const answers = rows.flatMap(({ id, r }) =>
        (r.answers ?? [])
          .filter((a) => questionIds.has(a.questionId) && a.value !== null && a.value !== undefined)
          .map((a) => ({
            responseId: id,
            questionId: questionIds.get(a.questionId)!,
            value: (a.value ?? null) as Prisma.InputJsonValue,
          })),
      );
      if (answers.length)
        await tx.surveyAnswer.createMany({
          data: answers,
          skipDuplicates: true,
        });
    }
  }
}
