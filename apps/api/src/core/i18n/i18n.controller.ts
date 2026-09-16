import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { I18nBundle, I18nService } from './i18n.service';

/**
 * `GET /i18n/:lang` — the login screen (and every other unauthenticated
 * surface, e.g. the future self-registration form) needs UI strings before
 * any session exists, so this is `@Public()` (ARCHITECTURE.md §9,
 * MODULE_SPEC.md §7). It is a READ with no per-caller side effect, so it is
 * deliberately NOT behind `PublicThrottlerGuard` — that guard is reserved for
 * public WRITE endpoints per MODULE_SPEC.md §7.3 ("never optional for one",
 * which by construction means "not required for a plain read").
 *
 * No `@RequirePermission` either: `PermissionGuard` already treats an
 * undecorated handler as "allowed" (see its docblock), and RBAC is
 * meaningless for anonymous visitors anyway (§7.1) — this endpoint has no
 * caller identity to check permissions against in the first place.
 */
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18nService: I18nService) {}

  @Get(':lang')
  @Public()
  async getBundle(@Param('lang') lang: string): Promise<I18nBundle> {
    return this.i18nService.getBundle(lang);
  }
}
