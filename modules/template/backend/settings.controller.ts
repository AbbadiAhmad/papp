import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UpdateDefaultsDto } from './dto/update-defaults.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { SettingsService } from './settings.service';

/**
 * The module's own minimal settings surface — see settings.service.ts's own
 * docblock for why this exists instead of a generic core Settings-screen
 * endpoint (that generic surface doesn't exist yet, root docs/DECISIONS.md D70).
 */
@Controller('api/template/settings')
@UseGuards(MustChangePasswordGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('defaults')
  @RequirePermission('template.settings.view')
  async getDefaults() {
    return this.settings.getDefaults();
  }

  @Put('defaults')
  @RequirePermission('template.settings.update')
  @Audit({ category: 'template.settings', entityType: 'SystemSetting', action: 'update' })
  async updateDefaults(@Body() dto: UpdateDefaultsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateDefaults(dto, user.userId);
  }
}
