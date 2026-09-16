import { Module } from '@nestjs/common';
import { MigrationRunnerService } from './migration-runner.service';
import { ModuleRegistryController } from './module-registry.controller';
import { ModuleRegistryService } from './module-registry.service';

/**
 * Not `@Global()`: unlike PermissionsService/SettingsService, nothing
 * outside this module needs `ModuleRegistryService` injected today. (Not
 * `MigrationRunnerService` either, technically — main.ts still constructs it
 * via `app.get(MigrationRunnerService)` for core's own migrations, which
 * works regardless of which module provides it, as long as exactly one does;
 * it now lives here instead of directly on AppModule's own providers array.)
 */
@Module({
  controllers: [ModuleRegistryController],
  providers: [MigrationRunnerService, ModuleRegistryService],
  exports: [MigrationRunnerService, ModuleRegistryService],
})
export class ModuleRegistryModule {}
