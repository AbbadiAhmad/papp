import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ReplaceMenuItemsDto } from './dto/replace-menu-items.dto';
import { MenusService } from './menus.service';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';

@Controller('api/website/menus')
@UseGuards(MustChangePasswordGuard)
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  @Get(':location')
  @RequirePermission('website.menus.view')
  async list(@Param('location') location: 'header' | 'footer') {
    return this.menus.list(location);
  }

  @Put(':location')
  @RequirePermission('website.menus.update')
  @Audit({ category: 'website.menus', entityType: 'WebsiteMenuItem', action: 'update' })
  async replace(@Param('location') location: 'header' | 'footer', @Body() dto: ReplaceMenuItemsDto) {
    return this.menus.replace(location, dto.items);
  }
}
