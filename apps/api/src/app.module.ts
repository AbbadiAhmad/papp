import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuditModule } from './core/audit/audit.module';
import { AuthModule } from './core/auth/auth.module';
import { I18nModule } from './core/i18n/i18n.module';
import { ModuleRegistryModule } from './core/module-registry/module-registry.module';
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
    I18nModule,
    ModuleRegistryModule,
    AuthModule,
    SessionsModule,
    UsersModule,
    RolesModule,
  ],
  controllers: [AppController],
  providers: [
    // Phase 5 global-guard switch (docs/BUILD_PLAN.md Phase 5 item 8):
    // registered in THIS order — JwtAuthGuard must populate `request.user`
    // before PermissionGuard reads it, and Nest runs multiple APP_GUARD
    // providers in registration order. `@Public()` is what exempts
    // /auth/login, /auth/refresh, /auth/register and GET /i18n/:lang (both
    // guards already recognize it — see their own docblocks). Every
    // controller that used to apply `@UseGuards(JwtAuthGuard, ...,
    // PermissionGuard)` locally has had those two removed as redundant;
    // `MustChangePasswordGuard` stays controller-scoped exactly as before
    // (see its own docblock for why, and this Developer agent's report for
    // why that ordering is still correct now that PermissionGuard is global).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    // AuditInterceptor is GLOBAL, opt-out not opt-in (ARCHITECTURE.md §8.2):
    // it no-ops on any handler without @Audit metadata, so registering it
    // app-wide costs nothing on unaudited routes and means no controller can
    // forget to apply it.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
