import { Global, Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

/**
 * Global: `PermissionGuard` and `PermissionsPageGuard` are applied from
 * `common/guards` on controllers all across the app (Users, Sessions, Roles,
 * Permissions itself, and every future module), so `PermissionsService` must
 * be injectable everywhere without every feature module re-importing this
 * one explicitly — same pattern as `PrismaModule`.
 */
@Global()
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
