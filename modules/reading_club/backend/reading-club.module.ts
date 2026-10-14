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
// eslint-disable-next-line import/no-unresolved
import { PermissionsService } from '../../../apps/api/dist/core/permissions/permissions.service';
import { CLUB_EVENT_PUBLISHER } from './club-events';
import { ClubEventsService } from './club-events.service';
import { ConfirmRewardController } from './confirm-reward.controller';
import { DashboardController } from './dashboard.controller';
import { EventSubscriptionsController } from './event-subscriptions.controller';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { NOTIFICATIONS_SENDER } from './notifications-sender';
import { PERMISSION_CHECKER } from './permission-checker';
import { READER_IMPORT_EXTENSION, ReaderImportService } from './reader-import.service';
import { PresentsController } from './presents.controller';
import { PresentsService } from './presents.service';
import { StageBookEntriesController } from './stage-book-entries.controller';
import { StageBookEntriesService } from './stage-book-entries.service';
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
  controllers: [
    EpisodesController,
    GroupsController,
    MembershipsController,
    StageCompletionsController,
    StageBookEntriesController,
    ConfirmRewardController,
    DashboardController,
    EventSubscriptionsController,
    PresentsController,
  ],
  providers: [
    EpisodesService,
    GroupsService,
    MembershipsService,
    StageCompletionsService,
    StageBookEntriesService,
    PresentsService,
    ClubEventsService,
    ReaderImportService,
    // Picked up lazily by library_circulation's readers import (ModuleRef, strict:false) — see its reader-import-extension.ts.
    { provide: READER_IMPORT_EXTENSION, useExisting: ReaderImportService },
    { provide: NOTIFICATIONS_SENDER, useExisting: NotificationsService },
    { provide: PERMISSION_CHECKER, useExisting: PermissionsService },
    { provide: CLUB_EVENT_PUBLISHER, useExisting: ClubEventsService },
  ],
})
export class ReadingClubModule {}
