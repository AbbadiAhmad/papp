import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// The REAL core guard, imported from apps/api's BUILT output — see
// platform.ts's docblock / modules/library_catalog/backend/public.controller.ts
// for exactly why (D57's exception category).
// eslint-disable-next-line import/no-unresolved
import { PublicThrottlerGuard } from '../../../apps/api/dist/common/guards/public-throttler.guard';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { Public } from './platform';
import { extractRequestMeta } from './request-meta';
import { ResponsesService } from './responses.service';

/**
 * The PUBLIC/ANONYMOUS half of the fill/submit split — reachable with no
 * `Authorization` header at all (MODULE_SPEC.md §7, mirrors
 * library_catalog's own PublicBooksController). `ResponsesService` itself
 * rejects with a 403 if the survey's own `requiresLogin` is true; the
 * frontend's single `/survey/:id` route turns that into a "please log in"
 * prompt rather than a raw error.
 *
 * `PublicThrottlerGuard` is applied to the WRITES only (submit/edit) —
 * MODULE_SPEC.md §7.3's public-write-abuse-mitigation rule; the read is
 * left unthrottled like library_catalog's own public GET.
 */
@Controller('api/survey/public')
export class PublicSurveyController {
  constructor(private readonly responses: ResponsesService) {}

  @Get(':id')
  @Public()
  async getForFilling(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.responses.getForFilling(id, null);
  }

  @Post(':id')
  @Public()
  @UseGuards(PublicThrottlerGuard)
  async submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SubmitResponseDto, @Req() req: Request) {
    return this.responses.submitPublic(id, dto.answers, extractRequestMeta(req));
  }

  /**
   * `editToken` travels as a query param, not a route segment — no
   * responseId is needed at all (ResponsesService.editPublic looks the
   * response up by the token's hash alone; see its own docblock).
   */
  @Patch(':id')
  @Public()
  @UseGuards(PublicThrottlerGuard)
  async edit(@Param('id', new ParseUUIDPipe()) id: string, @Query('editToken') editToken: string, @Body() dto: SubmitResponseDto, @Req() req: Request) {
    return this.responses.editPublic(id, editToken, dto.answers, extractRequestMeta(req));
  }
}
