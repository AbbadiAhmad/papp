import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MigrationRunnerService } from './core/module-registry/migration-runner.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
  // MigrationRunnerService is provided here (rather than its own module) for
  // Phase 0 — it grows into the full ModuleRegistryModule in Phase 5 once
  // manifest validation / install-upgrade-uninstall flows are built.
  providers: [MigrationRunnerService],
})
export class AppModule {}
