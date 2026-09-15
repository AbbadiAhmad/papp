import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Global so AuthModule/SessionsModule/(later) NotificationsModule can all
 * inject SettingsService without re-importing this module everywhere —
 * same pattern as PrismaModule.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
