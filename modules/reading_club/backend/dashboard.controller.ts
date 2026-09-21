import { Controller, Get, UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { MustChangePasswordGuard, RequirePermission } from './platform';
import { StageCompletionsService } from './stage-completions.service';

/** "The dashboard shows the groups and stages statistics" — real aggregate counts from GroupsService/StageCompletionsService, no mock data (same composition pattern as library_circulation's own DashboardController). */
@Controller('api/reading-club/dashboard')
@UseGuards(MustChangePasswordGuard)
export class DashboardController {
  constructor(
    private readonly groups: GroupsService,
    private readonly stageCompletions: StageCompletionsService,
  ) {}

  @Get()
  @RequirePermission('reading_club.dashboard.view')
  async getStats() {
    const [groupStats, pendingRewardsCount] = await Promise.all([
      this.groups.getDashboardStats(),
      this.stageCompletions.getPendingRewardsCount(),
    ]);
    return { ...groupStats, pendingRewardsCount };
  }
}
