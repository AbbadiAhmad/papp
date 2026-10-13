import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { GivePresentDto } from './dto/give-present.dto';
import { PresentsService } from './presents.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

@Controller('api/reading-club/readers')
@UseGuards(MustChangePasswordGuard)
export class PresentsController {
  constructor(private readonly presents: PresentsService) {}

  @Post(':studentId/presents')
  @RequirePermission('reading_club.presents.give')
  @Audit({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'give' })
  async give(@Param('studentId', new ParseUUIDPipe()) studentId: string, @Body() dto: GivePresentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.presents.give(studentId, dto, user.userId);
  }
}
