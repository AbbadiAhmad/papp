import { Global, Module } from '@nestjs/common';
import { I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';

/**
 * Global so `ModuleRegistryService` (install/upgrade/uninstall all change
 * which module locale bundles should be merged in) can inject `I18nService`
 * and call `rebuild()` without re-importing this module — same pattern as
 * `PrismaModule`/`SettingsModule`/`PermissionsModule`.
 */
@Global()
@Module({
  controllers: [I18nController],
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
