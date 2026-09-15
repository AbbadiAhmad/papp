import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './core/auth/auth.module';
import { MigrationRunnerService } from './core/module-registry/migration-runner.service';
import { SessionsModule } from './core/sessions/sessions.module';
import { SettingsModule } from './core/settings/settings.module';
import { UsersModule } from './core/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, SettingsModule, AuthModule, SessionsModule, UsersModule],
  controllers: [AppController],
  // MigrationRunnerService is provided here (rather than its own module) for
  // Phase 0 — it grows into the full ModuleRegistryModule in Phase 5 once
  // manifest validation / install-upgrade-uninstall flows are built.
  providers: [MigrationRunnerService],
})
export class AppModule {}
