import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { EMPTY_MENU_LAYOUT, type MenuLayout, menuLayoutSchema, type ThemePack } from '@papp/shared-types';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateLandingPagesDto } from '../settings/dto/update-landing-pages.dto';
import { LandingService } from '../settings/landing.service';
import { SettingsService } from '../settings/settings.service';
import { ThemesService } from './themes.service';

export const ACTIVE_THEME_KEY = 'appearance.active_theme';
export const BRANDING_KEY = 'appearance.branding';
export const DEFAULT_APP_TITLE = 'Annur Apps';
export const MENU_LAYOUT_KEY = 'appearance.menu_layout';
/** The built-in look; always valid, needs no pack on disk. */
export const DEFAULT_THEME_KEY = 'default';

/**
 * Appearance (D95/D96). Writes go through `SettingsService.set()`, which
 * already writes the audit row (old/new value) — so, exactly like
 * SettingsController, no `@Audit` decorator here (it would double-log).
 *
 *  - GET  /appearance/active       @Public: the login page needs the theme.
 *  - GET  /appearance/menu-layout  logged in is enough (the sidebar renders from it).
 *  - GET  /appearance/themes       appearance.view
 *  - PUT  /appearance/active-theme, PUT /appearance/menu-layout   appearance.manage
 *  - GET  /appearance/branding     @Public: the app title shown in the top bar (per language)
 *  - GET/PUT /appearance/landing-pages  appearance.view / appearance.manage: which page opens first
 */
@Controller('appearance')
@UseGuards(MustChangePasswordGuard)
export class AppearanceController {
  constructor(
    private readonly settings: SettingsService,
    private readonly themes: ThemesService,
    private readonly landing: LandingService,
  ) {}

  @Get('active')
  @Public()
  async getActive(): Promise<{ key: string; theme: ThemePack | null }> {
    const key = await this.settings.get<string>(ACTIVE_THEME_KEY);
    const theme = key === DEFAULT_THEME_KEY ? null : await this.themes.findTheme(key);
    // An active key whose pack was removed from disk falls back to the built-in look.
    return { key: theme ? key : DEFAULT_THEME_KEY, theme };
  }

  @Get('themes')
  @RequirePermission('appearance.view')
  async listThemes(): Promise<{ activeKey: string; themes: ThemePack[] }> {
    const [activeKey, themes] = await Promise.all([this.settings.get<string>(ACTIVE_THEME_KEY), this.themes.listThemes()]);
    return { activeKey, themes };
  }

  /**
   * A theme's own picture (e.g. the header background). `@Public()`: the login
   * page shows it. Only files named by a validated pack's `headerImage` are
   * ever served (never a path from the URL), so there is no traversal surface;
   * SVGs get a locked-down CSP so an uploaded SVG can't run script.
   */
  @Get('themes/:key/assets/:file')
  @Public()
  async getThemeAsset(@Param('key') key: string, @Param('file') file: string, @Res() res: Response): Promise<void> {
    const asset = await this.themes.readHeaderImage(key, file);
    if (!asset) throw new NotFoundException();
    res.set({
      'Content-Type': asset.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(asset.data);
  }

  @Put('active-theme')
  @RequirePermission('appearance.manage')
  async setActiveTheme(@Body() body: { key?: unknown }, @CurrentUser() user: AuthenticatedUser): Promise<{ key: string }> {
    const key = typeof body?.key === 'string' ? body.key : '';
    if (key !== DEFAULT_THEME_KEY && !(await this.themes.findTheme(key))) {
      throw new BadRequestException('appearance_theme_not_found');
    }
    await this.settings.set(ACTIVE_THEME_KEY, key, user.userId);
    return { key };
  }

  @Get('menu-layout')
  async getMenuLayout(): Promise<MenuLayout> {
    const stored = await this.settings.get<unknown>(MENU_LAYOUT_KEY);
    const parsed = menuLayoutSchema.safeParse(stored);
    // A hand-edited / corrupt row must never break the sidebar: fall back to the default order.
    return parsed.success ? parsed.data : EMPTY_MENU_LAYOUT;
  }

  @Put('menu-layout')
  @RequirePermission('appearance.manage')
  async setMenuLayout(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser): Promise<MenuLayout> {
    const parsed = menuLayoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'appearance_menu_layout_invalid', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    await this.settings.set(MENU_LAYOUT_KEY, parsed.data, user.userId);
    return parsed.data;
  }

  /** Never throws and never returns an empty title: a missing/corrupt row falls back to the built-in name. */
  @Get('branding')
  @Public()
  async getBranding(): Promise<AppBranding> {
    const stored = await this.settings.get<Partial<AppBranding> | null>(BRANDING_KEY).catch(() => null);
    return normalizeBranding(stored);
  }

  @Put('branding')
  @RequirePermission('appearance.manage')
  async setBranding(@Body() dto: UpdateBrandingDto, @CurrentUser() user: AuthenticatedUser): Promise<AppBranding> {
    const branding = normalizeBranding({ titleAr: dto.titleAr, titleEn: dto.titleEn });
    await this.settings.set(BRANDING_KEY, branding, user.userId);
    return branding;
  }

  @Get('landing-pages')
  @RequirePermission('appearance.view')
  async getLandingPages() {
    return this.landing.getAdminView();
  }

  /** Audited by SettingsService.set() like every other write here (no @Audit, see class docblock). */
  @Put('landing-pages')
  @RequirePermission('appearance.manage')
  async setLandingPages(@Body() dto: UpdateLandingPagesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.landing.update(dto, user.userId);
  }
}

export interface AppBranding {
  titleAr: string;
  titleEn: string;
}

/** Each language falls back to the other, then to the built-in name, so the bar is never blank. */
function normalizeBranding(stored: Partial<AppBranding> | null | undefined): AppBranding {
  const ar = typeof stored?.titleAr === 'string' ? stored.titleAr.trim() : '';
  const en = typeof stored?.titleEn === 'string' ? stored.titleEn.trim() : '';
  return { titleAr: ar || en || DEFAULT_APP_TITLE, titleEn: en || ar || DEFAULT_APP_TITLE };
}
