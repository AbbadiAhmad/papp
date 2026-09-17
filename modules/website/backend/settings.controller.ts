import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UpdateSiteConfigDto } from './dto/update-site-config.dto';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';
import { SettingsService } from './settings.service';

@Controller('api/website/settings')
@UseGuards(MustChangePasswordGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('site-config')
  @RequirePermission('website.settings.update')
  async getSiteConfig() {
    return this.settings.getSiteConfig();
  }

  @Put('site-config')
  @RequirePermission('website.settings.update')
  @Audit({ category: 'website.settings', entityType: 'SystemSetting', action: 'update' })
  async updateSiteConfig(@Body() dto: UpdateSiteConfigDto) {
    return this.settings.updateSiteConfig(dto);
  }
}
