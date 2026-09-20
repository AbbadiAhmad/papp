import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';
import { ReportsService } from './reports.service';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fetchResponseState = (prisma: PrismaClient, req: Request) =>
  prisma.surveyResponse.findUnique({ where: { id: req.params.responseId as string }, include: { answers: true } });

/**
 * The admin surface over SUBMITTED responses (list/view/delete) plus the
 * report/export endpoints — deliberately a separate controller from
 * `SurveysController` (which only manages the survey DEFINITION) even
 * though both live under `api/survey/surveys/:id/...`; Nest happily
 * resolves routes from multiple controllers sharing a path prefix, same as
 * how library_catalog keeps a book's own CRUD and its copies handling in
 * one controller only because that split wouldn't have been as clean —
 * here it is.
 *
 * `export`/`report/*` are declared BEFORE `:responseId` (Nest/Express
 * matches routes in declaration order) so `GET .../responses/export` can
 * never be swallowed by `GET .../responses/:responseId` — same ordering
 * rule BooksController's own `export` route follows.
 */
@Controller('api/survey/surveys')
@UseGuards(MustChangePasswordGuard)
export class ResponsesController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':id/responses/export')
  @RequirePermission('survey.responses.export')
  async export(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const buffer = await this.reports.exportResponsesWorkbook(id);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="survey-responses-export.xlsx"' });
    res.send(buffer);
  }

  @Get(':id/report/summary')
  @RequirePermission('survey.responses.view')
  async summary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.reports.getSummary(id);
  }

  @Get(':id/report/dataset')
  @RequirePermission('survey.responses.view')
  async dataset(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.reports.getDataset(id);
  }

  @Get(':id/responses')
  @RequirePermission('survey.responses.view')
  async list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.reports.listResponses(id);
  }

  @Get(':id/responses/:responseId')
  @RequirePermission('survey.responses.view')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string, @Param('responseId', new ParseUUIDPipe()) responseId: string) {
    return this.reports.getResponse(id, responseId);
  }

  @Delete(':id/responses/:responseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('survey.responses.delete')
  @Audit({ category: 'survey.responses', entityType: 'SurveyResponse', action: 'delete', entityIdParam: 'responseId', fetchState: fetchResponseState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Param('responseId', new ParseUUIDPipe()) responseId: string): Promise<void> {
    await this.reports.removeResponse(id, responseId);
  }
}
