import { Module } from '@nestjs/common';
import { CirculationController } from './circulation.controller';
import { CirculationService } from './circulation.service';
import { FinesController } from './fines.controller';
import { FinesService } from './fines.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * The module's `backend.entry` target (manifest.json). Compiled to plain
 * CommonJS (`library-circulation.module.js`, via this module's own
 * `tsconfig.json`) — same pattern as every other module, see
 * `modules/template/backend/template.module.ts`'s own docblock.
 */
@Module({
  controllers: [StudentsController, CirculationController, FinesController, SettingsController],
  providers: [StudentsService, CirculationService, FinesService, SettingsService],
})
export class LibraryCirculationModule {}
