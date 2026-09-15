import { Module } from '@nestjs/common';
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
  controllers: [ExcelImportController, UsersController],
  providers: [UsersService, ExcelImportService],
  exports: [UsersService],
})
export class UsersModule {}
