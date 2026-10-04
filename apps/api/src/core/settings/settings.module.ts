import { Global, Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Global so AuthModule/SessionsModule/NotificationsModule can all inject
 * SettingsService without re-importing this module everywhere — same
 * pattern as PrismaModule. Phase 4 adds SettingsController (the three
 * admin Settings tabs, ARCHITECTURE.md §6.3).
 *
 * Imports RolesModule (no circular risk — RolesModule has no dependency
 * back on SettingsModule) so SettingsController can validate
 * `selfRegistrationRoleCode` against the real `roles` table before saving
 * it — the DTO alone can't see the DB, and a typo'd/stale role code saved
 * as-is would make every future self-registration 500 instead of
 * rejecting the bad input up front.
 */
@Global()
@Module({
  imports: [RolesModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
