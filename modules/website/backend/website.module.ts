import { Module } from '@nestjs/common';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PublicController } from './public.controller';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`website.module.js`, via this module's own `tsconfig.json`) —
 * same pattern as every other module.
 */
@Module({
  controllers: [PagesController, MenusController, SettingsController, PublicController],
  providers: [PagesService, MenusService, SettingsService],
})
export class WebsiteModule {}
