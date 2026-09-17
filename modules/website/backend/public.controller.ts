import { Controller, Get, Param } from '@nestjs/common';
import { MenusService } from './menus.service';
import { PagesService } from './pages.service';
import { Public } from './platform';
import { SettingsService } from './settings.service';

/**
 * Read-only public surface (MODULE_SPEC.md §7.1: never redirects to login).
 * No `PublicThrottlerGuard` — that guard is required for public WRITE
 * endpoints (MODULE_SPEC.md §7.3); these are all reads.
 */
@Controller('api/website/public')
export class PublicController {
  constructor(
    private readonly pages: PagesService,
    private readonly menus: MenusService,
    private readonly settings: SettingsService,
  ) {}

  @Get('pages/:slug')
  @Public()
  async getPageBySlug(@Param('slug') slug: string) {
    return this.pages.findPublicBySlug(slug);
  }

  @Get('homepage')
  @Public()
  async getHomepage() {
    return this.pages.findPublicHomepage();
  }

  @Get('menus/:location')
  @Public()
  async getMenu(@Param('location') location: 'header' | 'footer') {
    return this.menus.listPublic(location);
  }

  @Get('site-config')
  @Public()
  async getSiteConfig() {
    return this.settings.getSiteConfig();
  }
}
