import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AudienceService } from './audience.service';
import { AddCollaboratorDto } from './dto/add-collaborator.dto';
import { InviteDto } from './dto/invite.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard } from './platform';
import { SurveyAccess, SurveyAccessGuard } from './survey-access';

/**
 * Who may respond and the invitations (survey ext. H, SURVEY-D22). Editing rights on the survey are enough
 * (permission `survey.surveys.update`, or being a co-owner). The mutating calls return small summaries — never the
 * whole list of email addresses — so the audit trail does not copy the audience each time; the page re-reads
 * `GET :id/audience` afterwards.
 */
@Controller('api/survey/surveys/:id')
@UseGuards(MustChangePasswordGuard, SurveyAccessGuard)
export class AudienceController {
  constructor(private readonly audience: AudienceService) {}

  @Get('audience')
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.audience.getAudience(id);
  }

  @Post('audience/users')
  @HttpCode(HttpStatus.CREATED)
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  @Audit({ category: 'survey.surveys', entityType: 'SurveyAllowedUser', action: 'add_allowed_user' })
  async addUser(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddCollaboratorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.audience.addAllowedUser(id, dto.email, user.userId);
  }

  @Delete('audience/users/:userId')
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  @Audit({ category: 'survey.surveys', entityType: 'SurveyAllowedUser', action: 'remove_allowed_user' })
  async removeUser(@Param('id', new ParseUUIDPipe()) id: string, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.audience.removeAllowedUser(id, userId);
  }

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  @Audit({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'invite' })
  async invite(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: InviteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.audience.invite(id, dto.emails, user.userId);
  }

  @Post('invitations/remind')
  @HttpCode(HttpStatus.CREATED)
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  @Audit({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'remind' })
  async remind(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.audience.remind(id);
  }

  @Delete('invitations/:invitationId')
  @SurveyAccess('survey.surveys.update', { collaborator: true })
  @Audit({ category: 'survey.surveys', entityType: 'SurveyInvitation', action: 'remove_invitation' })
  async removeInvitation(@Param('id', new ParseUUIDPipe()) id: string, @Param('invitationId', new ParseUUIDPipe()) invitationId: string) {
    return this.audience.removeInvitation(id, invitationId);
  }
}
