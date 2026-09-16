import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { SurveyStructureDto } from './dto/survey-structure.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { SurveysService } from './surveys.service';

const fetchSurveyState = (prisma: PrismaClient, req: Request) =>
  prisma.surveySurvey.findUnique({ where: { id: req.params.id as string } });

/**
 * The builder/admin surface (docs/DECISIONS.md — plain RBAC, no per-owner
 * scoping: anyone holding the relevant `survey.*` permission manages EVERY
 * survey, exactly like library_catalog's BooksController manages every
 * book). `JwtAuthGuard`/`PermissionGuard`/`AuditInterceptor` are global —
 * only `MustChangePasswordGuard` needs applying locally, same as every
 * other module controller.
 */
@Controller('api/survey/surveys')
@UseGuards(MustChangePasswordGuard)
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @RequirePermission('survey.surveys.view')
  async list() {
    return this.surveys.list();
  }

  @Post()
  @RequirePermission('survey.surveys.create')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'create' })
  async create(@Body() dto: CreateSurveyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.surveys.create(dto, user.userId);
  }

  @Get(':id')
  @RequirePermission('survey.surveys.view')
  async findById(@Param('id') id: string) {
    return this.surveys.findById(id);
  }

  @Patch(':id')
  @RequirePermission('survey.surveys.update')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update', fetchState: fetchSurveyState })
  async update(@Param('id') id: string, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('survey.surveys.delete')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'delete', fetchState: fetchSurveyState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.surveys.remove(id);
  }

  @Post(':id/publish')
  @RequirePermission('survey.surveys.publish')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'publish', fetchState: fetchSurveyState })
  async publish(@Param('id') id: string) {
    return this.surveys.publish(id);
  }

  @Post(':id/close')
  @RequirePermission('survey.surveys.publish')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'close', fetchState: fetchSurveyState })
  async close(@Param('id') id: string) {
    return this.surveys.close(id);
  }

  @Put(':id/structure')
  @RequirePermission('survey.surveys.update')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update_structure' })
  async replaceStructure(@Param('id') id: string, @Body() dto: SurveyStructureDto) {
    return this.surveys.replaceStructure(id, dto);
  }
}
