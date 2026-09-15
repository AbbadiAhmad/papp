import { Global, Module } from '@nestjs/common';
import { AuditLogWriter } from './audit-log.writer';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global so the single audit-row funnel (`AuditLogWriter`) is injectable
 * everywhere it is needed without import ceremony — the globally-registered
 * AuditInterceptor, AuthService's direct login/logout rows and
 * SettingsService's write auditing (same pattern as PrismaModule /
 * SettingsModule).
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditLogWriter],
  exports: [AuditLogWriter],
})
export class AuditModule {}
