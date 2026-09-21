import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { StageCompletionsService } from './stage-completions.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

@Controller('api/reading-club/readers')
@UseGuards(MustChangePasswordGuard)
export class StageCompletionsController {
  constructor(private readonly stageCompletions: StageCompletionsService) {}

  @Post(':studentId/complete-stage')
  @RequirePermission('reading_club.stage_completions.mark')
  @Audit({ category: 'reading_club.stage_completions', entityType: 'ReadingClubStageCompletion', action: 'mark_complete' })
  async markComplete(@Param('studentId', new ParseUUIDPipe()) studentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stageCompletions.markComplete(studentId, user.userId);
  }

  /**
   * Feeds BOTH this module's own reader detail page AND library_circulation's
   * scan-page hook (see that module's ScanPage.tsx — a direct, cross-module-
   * TS-import-free `apiClient` call; DECISIONS.md has the full reasoning).
   * Gated on `reading_club.memberships.view` (not the narrower
   * `.confirm_reward`) so any role that can already see a reader's profile
   * can also see this — confirming the reward itself still requires the
   * stronger permission, checked separately in `ConfirmRewardController`.
   */
  @Get(':studentId/pending-rewards')
  @RequirePermission('reading_club.memberships.view')
  async pendingRewards(@Param('studentId', new ParseUUIDPipe()) studentId: string) {
    return this.stageCompletions.listPendingRewards(studentId);
  }
}
