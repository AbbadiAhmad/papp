import { Module } from '@nestjs/common';
// The REAL core module, imported from apps/api's BUILT output (D57/D64
// exception category — see responses.service.ts's own import docblock).
// NOT `@Global()`, so it must be imported explicitly to make
// `NotificationsService`/`NotificationEmailService` injectable into
// ResponsesService.
// eslint-disable-next-line import/no-unresolved
import { NotificationsModule } from '../../../apps/api/dist/core/notifications/notifications.module';
import { FillController } from './fill.controller';
import { PublicSurveyController } from './public-survey.controller';
import { ReportsService } from './reports.service';
import { ResponsesController } from './responses.controller';
import { ResponsesService } from './responses.service';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`survey.module.js`, via this module's own `tsconfig.json`) —
 * see modules/library_catalog/backend/library-catalog.module.ts's docblock
 * for what `module-loader.ts` expects.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SurveysController, FillController, PublicSurveyController, ResponsesController],
  providers: [SurveysService, ResponsesService, ReportsService],
})
export class SurveyModule {}
