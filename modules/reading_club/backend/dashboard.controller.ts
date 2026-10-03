import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { MustChangePasswordGuard, RequirePermission } from './platform';
import { StageCompletionsService } from './stage-completions.service';

/**
 * "The dashboard shows the groups and stages statistics" — real aggregate
 * counts from GroupsService/StageCompletionsService, no mock data (same
 * composition pattern as library_circulation's own DashboardController).
 * `episodeId` omitted -> current episode (READING_CLUB-D12), so a permitted
 * user can browse a past episode's dashboard read-only.
 *
 * `pendingRewards` (item C, the full list with reader identity) is folded
 * into this same endpoint rather than a separate one — one round trip, the
 * list is realistically small (school reading club, no pagination) — gated
 * by the SAME `reading_club.dashboard.view` permission as the rest of this
 * endpoint (READING_CLUB-D14: `StageCompletionsController.pendingRewards`
 * itself uses the broader `.memberships.view` for its per-reader variant,
 * reasoning "anyone who can see a reader's profile can see their own
 * pending rewards"; here the aggregate cross-reader list is squarely
 * dashboard content, so it stays under `.dashboard.view` rather than
 * introducing a permission split within one response).
 */
@Controller('api/reading-club/dashboard')
@UseGuards(MustChangePasswordGuard)
export class DashboardController {
  constructor(
    private readonly groups: GroupsService,
    private readonly stageCompletions: StageCompletionsService,
  ) {}

  @Get()
  @RequirePermission('reading_club.dashboard.view')
  async getStats(@Query('episodeId') episodeId?: string) {
    const [groupStats, pendingRewardsCount, pendingRewards] = await Promise.all([
      this.groups.getDashboardStats(episodeId),
      this.stageCompletions.getPendingRewardsCount(episodeId),
      this.stageCompletions.listAllPendingRewards(episodeId),
    ]);
    return { ...groupStats, pendingRewardsCount, pendingRewards };
  }
}
