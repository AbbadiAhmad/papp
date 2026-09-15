import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuditModule } from './core/audit/audit.module';
import { AuthModule } from './core/auth/auth.module';
import { MigrationRunnerService } from './core/module-registry/migration-runner.service';
import { NotificationsModule } from './core/notifications/notifications.module';
import { PermissionsModule } from './core/permissions/permissions.module';
import { RolesModule } from './core/roles/roles.module';
import { SessionsModule } from './core/sessions/sessions.module';
import { SettingsModule } from './core/settings/settings.module';
import { UsersModule } from './core/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    PermissionsModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    SessionsModule,
    UsersModule,
    RolesModule,
  ],
  controllers: [AppController],
  providers: [
    // MigrationRunnerService is provided here (rather than its own module)
    // for Phase 0 — it grows into the full ModuleRegistryModule in Phase 5
    // once manifest validation / install-upgrade-uninstall flows are built.
    MigrationRunnerService,
    // AuditInterceptor is GLOBAL, opt-out not opt-in (ARCHITECTURE.md §8.2):
    // it no-ops on any handler without @Audit metadata, so registering it
    // app-wide costs nothing on unaudited routes and means no controller can
    // forget to apply it.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
