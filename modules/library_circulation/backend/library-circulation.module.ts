import { Module } from '@nestjs/common';
// The REAL core module/service, imported from apps/api's BUILT output
// (D57/D64 exception category — not @Global(), so it must be imported
// explicitly). This is the ONLY file in this module allowed to import from
// `apps/api/dist/...` for notifications — see `notifications-sender.ts`'s
// own docblock for why `circulation.service.ts`/`fines.service.ts`
// themselves must NOT (breaks their Jest unit tests, root D68 item 3).
// eslint-disable-next-line import/no-unresolved
import { NotificationsModule } from '../../../apps/api/dist/core/notifications/notifications.module';
// eslint-disable-next-line import/no-unresolved
import { NotificationsService } from '../../../apps/api/dist/core/notifications/notifications.service';
import { CirculationController } from './circulation.controller';
import { CirculationService } from './circulation.service';
import { DashboardController } from './dashboard.controller';
import { FinesController } from './fines.controller';
import { FinesService } from './fines.service';
import { NOTIFICATIONS_SENDER } from './notifications-sender';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StudentsExcelService } from './students-excel.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`library-circulation.module.js`, via this module's own
 * `tsconfig.json`) — same pattern as every other module, see
 * `modules/template/backend/template.module.ts`'s own docblock.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [StudentsController, CirculationController, FinesController, SettingsController, DashboardController],
  providers: [
    StudentsService,
    StudentsExcelService,
    CirculationService,
    FinesService,
    SettingsService,
    { provide: NOTIFICATIONS_SENDER, useExisting: NotificationsService },
  ],
})
export class LibraryCirculationModule {}
