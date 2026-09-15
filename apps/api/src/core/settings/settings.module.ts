import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Global so AuthModule/SessionsModule/NotificationsModule can all inject
 * SettingsService without re-importing this module everywhere — same
 * pattern as PrismaModule. Phase 4 adds SettingsController (the three
 * admin Settings tabs, ARCHITECTURE.md §6.3).
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
