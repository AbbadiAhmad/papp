import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RolesModule } from '../roles/roles.module';
import { ExcelImportController } from './excel-import.controller';
import { ExcelImportService } from './excel-import.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // ExcelImportController MUST be registered before UsersController: Nest/
  // Express matches routes in registration order, and UsersController's
  // `GET /users/:id` would otherwise swallow `GET /users/export` (treating
  // "export" as the :id param) before ExcelImportController's literal route
  // ever gets a chance to match.
  // NotificationsModule: the password-reset / force-password-change notices
  // UsersService sends on the users PATCH path (BUILD_PLAN.md Phase 4).
  // RolesModule: UsersService reuses RolesService.assertNotLastActiveAdmin
  // (last-admin guard, see roles.service.ts) on delete/deactivate — one-way
  // dependency only, RolesService has no reverse dependency on UsersService.
  imports: [NotificationsModule, RolesModule],
  controllers: [ExcelImportController, UsersController],
  providers: [UsersService, ExcelImportService],
  exports: [UsersService],
})
export class UsersModule {}
