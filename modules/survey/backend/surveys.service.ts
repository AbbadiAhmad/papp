import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { ENUMERATION_QUESTION_TYPES, SurveyStructureDto } from './dto/survey-structure.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { describeProblem, validateOptionValues, validateQuestionConfig } from './question-rules';
import { computeAvailability, normalizeSettings, validateSurveyOptions } from './survey-settings';

/**
 * Real `PrismaClient` instance, not core's `PrismaService` — see
 * books.service.ts's own docblock in modules/library_catalog for the full
 * module-boundary rationale (a repo-relative import of core's PrismaService
 * would only resolve at runtime under one specific execution mode; a second
 * connection pool against the same generated client is the robust,
 * precedented choice every module makes).
 */
/** Normalised JSON stored in `survey_sections.navigation` ('{}' = just continue to the next section). */
function navigationOf(section: SurveyStructureDto['sections'][number]): Prisma.InputJsonValue {
  const nav = section.navigation;
  return {
    ...(nav?.defaultTarget ? { defaultTarget: nav.defaultTarget } : {}),
    ...(nav?.routes?.length
      ? { routes: nav.routes.map((r) => ({ sourceQuestionId: r.sourceQuestionId, sourceOptionValue: r.sourceOptionValue, target: r.target })) }
      : {}),
  };
}

@Injectable()
export class SurveysService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SurveysService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('survey Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
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
      availability: computeAvailability(s, s._count.responses),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async create(dto: CreateSurveyDto, ownerUserId: string) {
    return this.prisma.surveySurvey.create({
      data: { title: dto.title, description: dto.description, ownerUserId },
    });
  }

  async findById(id: string) {
    const survey = await this.getSurveyOrThrow(id, {
      sections: { orderBy: { orderIndex: 'asc' }, include: { questions: { orderBy: { orderIndex: 'asc' }, include: { options: { orderBy: { orderIndex: 'asc' } } } } } },
      logicRules: { orderBy: { orderIndex: 'asc' } },
    });
    return survey;
  }

  async update(id: string, dto: UpdateSurveyDto) {
    const current = await this.getSurveyOrThrow(id);

    // Effective values after this change (undefined = keep, null = clear), checked together so
    // "closes before it opens" is caught even when only one of the two dates is being edited.
    const opensAt = dto.opensAt === undefined ? current.opensAt : dto.opensAt;
    const closesAt = dto.closesAt === undefined ? current.closesAt : dto.closesAt;
    const problem = validateSurveyOptions({ thankYouMessage: dto.thankYouMessage, responseLimit: dto.responseLimit, opensAt, closesAt });
    if (problem) throw new BadRequestException(problem);

    // Survey-level options live in one JSONB column; merge the incoming keys into what is stored.
    let settings: Prisma.InputJsonValue | undefined;
    if (dto.thankYouMessage !== undefined || dto.showProgressBar !== undefined) {
      settings = normalizeSettings({
        ...normalizeSettings(current.settings),
        ...(dto.thankYouMessage !== undefined ? { thankYouMessage: dto.thankYouMessage } : {}),
        ...(dto.showProgressBar !== undefined ? { showProgressBar: dto.showProgressBar } : {}),
      }) as Prisma.InputJsonValue;
    }

    return this.prisma.surveySurvey.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        requiresLogin: dto.requiresLogin,
        allowEditAfterSubmit: dto.allowEditAfterSubmit,
        oneResponsePerRespondent: dto.oneResponsePerRespondent,
        notifyOwnerOnSubmit: dto.notifyOwnerOnSubmit,
        notifyEmails: dto.notifyEmails as unknown as Prisma.InputJsonValue,
        opensAt: dto.opensAt,
        closesAt: dto.closesAt,
        responseLimit: dto.responseLimit,
        settings,
        closedMessage: dto.closedMessage === undefined ? undefined : dto.closedMessage.trim() || null,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.getSurveyOrThrow(id);
    await this.prisma.surveySurvey.delete({ where: { id } });
  }

  async publish(id: string) {
    const survey = await this.getSurveyOrThrow(id, {
      sections: { include: { questions: true } },
    });
    this.assertNotArchived(survey);
    if (survey.status === 'published') return survey;
    if (survey.sections.length === 0 || survey.sections.every((s) => s.questions.length === 0)) {
      throw new BadRequestException('Cannot publish a survey with no questions');
    }
    return this.prisma.surveySurvey.update({ where: { id }, data: { status: 'published' } });
  }

  async close(id: string) {
    const survey = await this.getSurveyOrThrow(id);
    if (survey.status !== 'published') {
      throw new ConflictException('Only a published survey can be closed');
    }
    return this.prisma.surveySurvey.update({ where: { id }, data: { status: 'closed' } });
  }

  /** Moves a survey to the archive; a published one is closed first so it stops taking responses. */
  async archive(id: string) {
    const survey = await this.getSurveyOrThrow(id);
    if (survey.archivedAt) return survey;
    return this.prisma.surveySurvey.update({
      where: { id },
      data: { archivedAt: new Date(), status: survey.status === 'published' ? 'closed' : survey.status },
    });
  }

  /** Brings an archived survey back to the main list (its status is left as it was — a restored survey is never silently reopened). */
  async unarchive(id: string) {
    await this.getSurveyOrThrow(id);
    return this.prisma.surveySurvey.update({ where: { id }, data: { archivedAt: null } });
  }

  private assertNotArchived(survey: { archivedAt: Date | null }): void {
    if (survey.archivedAt) {
      throw new ConflictException('Restore this survey from the archive first');
    }
  }

  /** closed -> published again (a closed survey was previously a dead end). */
  async reopen(id: string) {
    const survey = await this.getSurveyOrThrow(id);
    this.assertNotArchived(survey);
    if (survey.status !== 'closed') {
      throw new ConflictException('Only a closed survey can be reopened');
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
  async replaceStructure(surveyId: string, dto: SurveyStructureDto) {
    await this.getSurveyOrThrow(surveyId);
    this.validateStructure(dto);

    return this.prisma.$transaction(async (tx) => {
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
          create: { id: section.id, surveyId, orderIndex: section.orderIndex, title: section.title, description: section.description, navigation: navigationOf(section) },
          update: { orderIndex: section.orderIndex, title: section.title, description: section.description, navigation: navigationOf(section) },
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
              config: (question.config ?? {}) as Prisma.InputJsonValue,
            },
            update: {
              sectionId: section.id,
              orderIndex: question.orderIndex,
              type: question.type,
              title: question.title,
              description: question.description,
              required: question.required ?? false,
              config: (question.config ?? {}) as Prisma.InputJsonValue,
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
  }

  // --- internals -------------------------------------------------------

  async getSurveyOrThrow<T extends Prisma.SurveySurveyInclude>(id: string, include?: T) {
    const survey = await this.prisma.surveySurvey.findUnique({ where: { id }, include });
    if (!survey) {
      throw new NotFoundException('Survey not found');
    }
    return survey as Prisma.SurveySurveyGetPayload<{ include: T }>;
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
  validateStructure(dto: SurveyStructureDto): void {
    const questionsById = new Map(dto.sections.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
    const sectionIds = new Set(dto.sections.map((s) => s.id));
    const sectionOfQuestion = new Map(dto.sections.flatMap((s) => s.questions.map((q) => [q.id, s.id] as const)));

    for (const section of dto.sections) {
      for (const question of section.questions) {
        if (ENUMERATION_QUESTION_TYPES.includes(question.type) && !(question.options?.length)) {
          throw new BadRequestException(`Question "${question.title}" (${question.type}) needs at least one option`);
        }
        // Option values must be unique and not collide with the reserved "Other" encoding; the
        // question's settings (validation, selection limits, "Other", scale...) must fit its type.
        const optionValues = (question.options ?? []).map((o) => o.value);
        const problem =
          (ENUMERATION_QUESTION_TYPES.includes(question.type) ? validateOptionValues(optionValues) : null) ??
          validateQuestionConfig(question.type, question.config, optionValues);
        if (problem) {
          throw new BadRequestException(`Question "${question.title}": ${describeProblem(problem)}`);
        }
      }
    }

    // Section navigation: jumps only go FORWARD (so a survey can never loop),
    // to a real later section or to 'submit'; a route's source is a choice
    // question of the section being left.
    const indexOfSection = new Map(dto.sections.map((s, i) => [s.id, i] as const));
    dto.sections.forEach((section, index) => {
      const nav = section.navigation;
      if (!nav) return;
      const checkTarget = (target: string | null | undefined) => {
        if (!target || target === 'submit') return;
        const targetIndex = indexOfSection.get(target);
        if (targetIndex === undefined) {
          throw new BadRequestException(`Section "${section.title}" navigates to an unknown section`);
        }
        if (targetIndex <= index) {
          throw new BadRequestException(`Section "${section.title}" can only go forward to a later section, or submit`);
        }
      };
      checkTarget(nav.defaultTarget);
      for (const route of nav.routes ?? []) {
        checkTarget(route.target);
        const source = section.questions.find((q) => q.id === route.sourceQuestionId);
        if (!source || !ENUMERATION_QUESTION_TYPES.includes(source.type)) {
          throw new BadRequestException(`Section "${section.title}": a "go to" condition must use a choice question from that same section`);
        }
        if (!(source.options ?? []).some((o) => o.value === route.sourceOptionValue)) {
          throw new BadRequestException(`Section "${section.title}": a "go to" condition uses an option that doesn't exist on "${source.title}"`);
        }
      }
    });

    for (const rule of dto.logicRules ?? []) {
      const sourceQuestion = questionsById.get(rule.sourceQuestionId);
      if (!sourceQuestion) {
        throw new BadRequestException(`Logic rule references unknown source question ${rule.sourceQuestionId}`);
      }
      if (!ENUMERATION_QUESTION_TYPES.includes(sourceQuestion.type)) {
        throw new BadRequestException(
          `Logic rule's source question "${sourceQuestion.title}" must be single_choice/multi_choice/dropdown, not ${sourceQuestion.type}`,
        );
      }
      const validValues = new Set((sourceQuestion.options ?? []).map((o) => o.value));
      if (!validValues.has(rule.sourceOptionValue)) {
        throw new BadRequestException(
          `Logic rule references option value "${rule.sourceOptionValue}" that doesn't exist on question "${sourceQuestion.title}"`,
        );
      }
      const targetExists = rule.targetType === 'section' ? sectionIds.has(rule.targetId) : questionsById.has(rule.targetId);
      if (!targetExists) {
        throw new BadRequestException(`Logic rule targets unknown ${rule.targetType} ${rule.targetId}`);
      }
      if (rule.targetId === rule.sourceQuestionId) {
        throw new BadRequestException('A logic rule cannot target its own source question');
      }
      // A question can never show/hide the section it lives in (it could hide
      // itself and become impossible to ever answer again).
      if (rule.targetType === 'section' && sectionOfQuestion.get(rule.sourceQuestionId) === rule.targetId) {
        throw new BadRequestException(`Question "${sourceQuestion.title}" cannot show or hide its own section`);
      }
    }
  }
}
