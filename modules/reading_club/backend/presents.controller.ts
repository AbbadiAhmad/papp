import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { GivePresentDto } from './dto/give-present.dto';
import { PresentsService } from './presents.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

@Controller('api/reading-club')
@UseGuards(MustChangePasswordGuard)
export class PresentsController {
  constructor(private readonly presents: PresentsService) {}

  @Post('readers/:studentId/presents')
  @RequirePermission('reading_club.presents.give')
  @Audit({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'give' })
  async give(@Param('studentId', new ParseUUIDPipe()) studentId: string, @Body() dto: GivePresentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.presents.give(studentId, dto, user.userId);
  }

  @Patch('presents/:presentId')
  @RequirePermission('reading_club.presents.manage')
  @Audit({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'update' })
  async update(@Param('presentId', new ParseUUIDPipe()) presentId: string, @Body() dto: GivePresentDto) {
    return this.presents.update(presentId, dto);
  }

  @Delete('presents/:presentId')
  @RequirePermission('reading_club.presents.manage')
  @Audit({ category: 'reading_club.presents', entityType: 'ReadingClubPresent', action: 'delete' })
  async remove(@Param('presentId', new ParseUUIDPipe()) presentId: string) {
    return this.presents.remove(presentId);
  }
}
