import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { DuplicateSurveyDto } from './dto/duplicate-survey.dto';
import { SurveyStructureDto } from './dto/survey-structure.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { SurveyTransferService } from './survey-transfer.service';
import { SurveysService } from './surveys.service';

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

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
  constructor(
    private readonly surveys: SurveysService,
    private readonly transfer: SurveyTransferService,
  ) {}

  @Get()
  @RequirePermission('survey.surveys.view')
  async list(@Query('archived') archived?: string) {
    return this.surveys.list(archived === 'true');
  }

  /** Declared before every `:id` route so `import` is never read as a survey id. */
  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('survey.surveys.import')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'import' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async importPackage(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body('includeResponses') includeResponses: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    return this.transfer.importZip(file.buffer, user.userId, includeResponses === 'true');
  }

  @Post()
  @RequirePermission('survey.surveys.create')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'create' })
  async create(@Body() dto: CreateSurveyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.surveys.create(dto, user.userId);
  }

  @Get(':id')
  @RequirePermission('survey.surveys.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.findById(id);
  }

  @Patch(':id')
  @RequirePermission('survey.surveys.update')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update', fetchState: fetchSurveyState })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('survey.surveys.delete')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'delete', fetchState: fetchSurveyState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.surveys.remove(id);
  }

  @Post(':id/publish')
  @RequirePermission('survey.surveys.publish')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'publish', fetchState: fetchSurveyState })
  async publish(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.publish(id);
  }

  @Post(':id/close')
  @RequirePermission('survey.surveys.publish')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'close', fetchState: fetchSurveyState })
  async close(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.close(id);
  }

  @Post(':id/reopen')
  @RequirePermission('survey.surveys.publish')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'reopen', fetchState: fetchSurveyState })
  async reopen(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.reopen(id);
  }

  @Post(':id/archive')
  @RequirePermission('survey.surveys.archive')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'archive', fetchState: fetchSurveyState })
  async archive(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.archive(id);
  }

  @Post(':id/unarchive')
  @RequirePermission('survey.surveys.archive')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'unarchive', fetchState: fetchSurveyState })
  async unarchive(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.surveys.unarchive(id);
  }

  @Post(':id/duplicate')
  @RequirePermission('survey.surveys.create')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'duplicate' })
  async duplicate(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DuplicateSurveyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transfer.duplicate(id, user.userId, dto.title);
  }

  /** Survey definition only (sections, questions, rules, settings). */
  @Get(':id/export')
  @RequirePermission('survey.surveys.export')
  async exportDefinition(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    await this.sendZip(res, id, false);
  }

  /** Definition plus every response — gated by the existing responses-export permission. */
  @Get(':id/export-with-responses')
  @RequirePermission('survey.responses.export')
  async exportWithResponses(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    await this.sendZip(res, id, true);
  }

  private async sendZip(res: Response, id: string, includeResponses: boolean): Promise<void> {
    const { buffer, filename } = await this.transfer.exportZip(id, includeResponses);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="survey.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    res.send(buffer);
  }

  @Put(':id/structure')
  @RequirePermission('survey.surveys.update')
  @Audit({ category: 'survey.surveys', entityType: 'SurveySurvey', action: 'update_structure' })
  async replaceStructure(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SurveyStructureDto) {
    return this.surveys.replaceStructure(id, dto);
  }
}
