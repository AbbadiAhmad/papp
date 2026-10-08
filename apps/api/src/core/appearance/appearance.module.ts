import { Module } from '@nestjs/common';
import { AppearanceController } from './appearance.controller';
import { ThemesService } from './themes.service';

@Module({
  controllers: [AppearanceController],
  providers: [ThemesService],
})
export class AppearanceModule {}
