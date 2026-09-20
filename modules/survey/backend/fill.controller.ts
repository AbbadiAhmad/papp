import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { AuthenticatedUser, CurrentUser, MustChangePasswordGuard } from './platform';
import { extractRequestMeta } from './request-meta';
import { ResponsesService } from './responses.service';

/**
 * The AUTHENTICATED half of the fill/submit split (this module's
 * implementation-plan §"Taking a survey — two endpoints, not one"):
 * deliberately carries NO `@RequirePermission(...)` at all. `PermissionGuard`
 * (global) already treats an undecorated handler as "any authenticated user,
 * any role" — the exact "being logged in is always a safe superset of a
 * public survey" rule the plan calls for, reusing an existing platform
 * mechanism rather than inventing a new one.
 *
 * Used whenever the visitor already has a session, REGARDLESS of the
 * survey's own `requiresLogin` value. A `requiresLogin` survey can ONLY be
 * filled through this controller; `PublicSurveyController` rejects it.
 */
@Controller('api/survey')
@UseGuards(MustChangePasswordGuard)
export class FillController {
  constructor(private readonly responses: ResponsesService) {}

  @Get(':id/fill')
  async getForFilling(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.responses.getForFilling(id, user.userId);
  }

  @Post(':id/fill')
  async submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SubmitResponseDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    // No @Audit here — ResponsesService writes its own audit_log row
    // directly (see responses.service.ts's writeResponse docblock).
    return this.responses.submitAuthenticated(id, user.userId, user.sessionId, dto.answers, extractRequestMeta(req));
  }
}
