import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { ENUMERATION_QUESTION_TYPES, SurveyStructureDto } from './dto/survey-structure.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';

/**
 * Real `PrismaClient` instance, not core's `PrismaService` — see
 * books.service.ts's own docblock in modules/library_catalog for the full
 * module-boundary rationale (a repo-relative import of core's PrismaService
 * would only resolve at runtime under one specific execution mode; a second
 * connection pool against the same generated client is the robust,
 * precedented choice every module makes).
 */
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

  async list() {
    const surveys = await this.prisma.surveySurvey.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { responses: true } } },
    });
    return surveys.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      status: s.status,
      requiresLogin: s.requiresLogin,
      responseCount: s._count.responses,
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
    await this.getSurveyOrThrow(id);
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
          create: { id: section.id, surveyId, orderIndex: section.orderIndex, title: section.title, description: section.description },
          update: { orderIndex: section.orderIndex, title: section.title, description: section.description },
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
  private validateStructure(dto: SurveyStructureDto): void {
    const questionsById = new Map(dto.sections.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
    const sectionIds = new Set(dto.sections.map((s) => s.id));

    for (const section of dto.sections) {
      for (const question of section.questions) {
        if (ENUMERATION_QUESTION_TYPES.includes(question.type) && !(question.options?.length)) {
          throw new BadRequestException(`Question "${question.title}" (${question.type}) needs at least one option`);
        }
      }
    }

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
    }
  }
}
