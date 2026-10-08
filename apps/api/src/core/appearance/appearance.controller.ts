import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { EMPTY_MENU_LAYOUT, type MenuLayout, menuLayoutSchema, type ThemePack } from '@papp/shared-types';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { SettingsService } from '../settings/settings.service';
import { ThemesService } from './themes.service';

export const ACTIVE_THEME_KEY = 'appearance.active_theme';
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
 */
@Controller('appearance')
@UseGuards(MustChangePasswordGuard)
export class AppearanceController {
  constructor(
    private readonly settings: SettingsService,
    private readonly themes: ThemesService,
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
}
