import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { StageCompletionsService } from './stage-completions.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

@Controller('api/reading-club/stage-completions')
@UseGuards(MustChangePasswordGuard)
export class ConfirmRewardController {
  constructor(private readonly stageCompletions: StageCompletionsService) {}

  /** Called from either this module's own reader page or library_circulation's scan-page hook — same endpoint either way. */
  @Post(':completionId/confirm-reward')
  @RequirePermission('reading_club.stage_completions.confirm_reward')
  @Audit({ category: 'reading_club.stage_completions', entityType: 'ReadingClubStageCompletion', action: 'confirm_reward' })
  async confirmReward(@Param('completionId', new ParseUUIDPipe()) completionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stageCompletions.confirmReward(completionId, user.userId);
  }
}
