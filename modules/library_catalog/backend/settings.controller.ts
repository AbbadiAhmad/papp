import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UpdateStickerLayoutDto } from './dto/update-sticker-layout.dto';
import { UpdateStickerSettingsDto } from './dto/update-sticker-settings.dto';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';
import { SettingsService } from './settings.service';

@Controller('api/library/settings')
@UseGuards(MustChangePasswordGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Gated by `copies.print_codes`, not `settings.update` — the Print Codes
  // page needs to READ the configured header text to render the sticker
  // preview even for a librarian who can print but isn't allowed to change
  // the setting itself. Only the PUT below needs `settings.update`.
  @Get('sticker')
  @RequirePermission('library_catalog.copies.print_codes')
  async getStickerSettings() {
    return this.settings.getStickerSettings();
  }

  @Put('sticker')
  @RequirePermission('library_catalog.settings.update')
  @Audit({ category: 'library_catalog.settings', entityType: 'SystemSetting', action: 'update' })
  async updateStickerSettings(@Body() dto: UpdateStickerSettingsDto) {
    return this.settings.updateStickerSettings(dto);
  }

  // The sticker designer's layout (LIBRARY_CATALOG-D33). Read by everyone who may print (the preview and the print
  // sheet need it), changed only with `settings.update`.
  @Get('sticker-layout')
  @RequirePermission('library_catalog.copies.print_codes')
  async getStickerLayout() {
    return this.settings.getStickerLayout();
  }

  @Put('sticker-layout')
  @RequirePermission('library_catalog.settings.update')
  @Audit({ category: 'library_catalog.settings', entityType: 'SystemSetting', action: 'update' })
  async updateStickerLayout(@Body() dto: UpdateStickerLayoutDto) {
    return this.settings.updateStickerLayout(dto.layout);
  }
}
