import { Module } from '@nestjs/common';
// The REAL core module/service, imported from apps/api's BUILT output
// (D57/D64 exception category) — the ONE file in this module allowed to
// import from `apps/api/dist/...` for notifications; see
// `notifications-sender.ts`'s own docblock for why `stage-completions.service.ts`
// itself must NOT (breaks its Jest unit tests, root D68 item 3).
// eslint-disable-next-line import/no-unresolved
import { NotificationsModule } from '../../../apps/api/dist/core/notifications/notifications.module';
// eslint-disable-next-line import/no-unresolved
import { NotificationsService } from '../../../apps/api/dist/core/notifications/notifications.service';
import { ConfirmRewardController } from './confirm-reward.controller';
import { DashboardController } from './dashboard.controller';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { NOTIFICATIONS_SENDER } from './notifications-sender';
import { StageCompletionsController } from './stage-completions.controller';
import { StageCompletionsService } from './stage-completions.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`reading-club.module.js`, via this module's own `tsconfig.json`)
 * — same pattern as every other module, see
 * `modules/template/backend/template.module.ts`'s own docblock.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [GroupsController, MembershipsController, StageCompletionsController, ConfirmRewardController, DashboardController],
  providers: [
    GroupsService,
    MembershipsService,
    StageCompletionsService,
    { provide: NOTIFICATIONS_SENDER, useExisting: NotificationsService },
  ],
})
export class ReadingClubModule {}
