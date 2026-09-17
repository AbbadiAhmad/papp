import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { PublicItemsController } from './public-items.controller';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`template.module.js`, via this module's own `tsconfig.json`) —
 * see modules/library_catalog/backend/library-catalog.module.ts's docblock
 * for what `module-loader.ts` expects. Deliberately imports NOTHING from
 * another core module (no `NotificationsModule`, unlike `survey`) — most
 * modules don't need cross-module notification wiring; see `survey`'s own
 * `survey.module.ts`/DOCUMENTATION.md if yours does.
 */
@Module({
  controllers: [ItemsController, PublicItemsController, SettingsController],
  providers: [ItemsService, SettingsService],
})
export class TemplateModule {}
