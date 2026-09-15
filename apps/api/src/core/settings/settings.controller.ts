import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { assertValidTemplates, UpdateNotificationTemplatesDto } from './dto/update-notification-templates.dto';
import { UpdatePasswordPolicyDto } from './dto/update-password-policy.dto';
import { UpdateSessionTimingDto } from './dto/update-session-timing.dto';
import { SettingsService } from './settings.service';
import {
  NOTIFICATION_TEMPLATE_KEY_PREFIX,
  NotificationTemplate,
  PASSWORD_POLICY_KEY,
  PasswordPolicy,
  TOKEN_LIFETIMES_KEY,
  TokenLifetimes,
} from './settings.types';

/**
 * The three core Settings tabs (ARCHITECTURE.md §6.3): Password Policy,
 * Session Timing, Notification Templates. Permission-gated by
 * `users.settings.view` / `users.settings.update` — NOT hardcoded to admin
 * (§7.4 stays the only role-name exception in the codebase). Per §12.4,
 * `notifications.templates.manage` is "effectively users.settings.update",
 * so the templates tab is gated by the same users.settings.* codes as the
 * other two tabs; the notifications.templates.manage catalog entry exists
 * (seeded in 0006, granted to admin) for a future finer split.
 *
 * Auditing: NO `@Audit(...)` decorators here — deliberately. Every write
 * already produces its audit row inside `SettingsService.set()` (the Phase 3
 * retrofit: category 'core.settings', old/new value, @Sensitive-redacted).
 * Adding the interceptor on top would double-log every PUT (and N+1-log the
 * templates PUT). The controller's job is only to pass the caller's userId
 * through as `updatedBy`, which is what makes the service-level row an
 * actor_type='user' row instead of 'system'.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard, PermissionGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // --- Tab 1: Password Policy (D23) ---------------------------------------

  @Get('password-policy')
  @RequirePermission('users.settings.view')
  async getPasswordPolicy(): Promise<PasswordPolicy> {
    return this.settingsService.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
  }

  @Put('password-policy')
  @RequirePermission('users.settings.update')
  async updatePasswordPolicy(
    @Body() dto: UpdatePasswordPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PasswordPolicy> {
    await this.settingsService.set(PASSWORD_POLICY_KEY, { ...dto }, user.userId);
    return this.settingsService.get<PasswordPolicy>(PASSWORD_POLICY_KEY);
  }

  // --- Tab 2: Session Timing (D24) -----------------------------------------

  @Get('session-timing')
  @RequirePermission('users.settings.view')
  async getSessionTiming(): Promise<TokenLifetimes> {
    return this.settingsService.get<TokenLifetimes>(TOKEN_LIFETIMES_KEY);
  }

  @Put('session-timing')
  @RequirePermission('users.settings.update')
  async updateSessionTiming(
    @Body() dto: UpdateSessionTimingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TokenLifetimes> {
    await this.settingsService.set(TOKEN_LIFETIMES_KEY, { ...dto }, user.userId);
    return this.settingsService.get<TokenLifetimes>(TOKEN_LIFETIMES_KEY);
  }

  // --- Tab 3: Notification Templates (D22) ---------------------------------

  /** Returned keyed by SUFFIX (e.g. "password_reset"), matching the PUT body shape. */
  @Get('notification-templates')
  @RequirePermission('users.settings.view')
  async getNotificationTemplates(): Promise<Record<string, NotificationTemplate>> {
    const byFullKey = await this.settingsService.getManyByPrefix(NOTIFICATION_TEMPLATE_KEY_PREFIX);
    return Object.fromEntries(
      Object.entries(byFullKey).map(([fullKey, value]) => [
        fullKey.slice(NOTIFICATION_TEMPLATE_KEY_PREFIX.length),
        value as NotificationTemplate,
      ]),
    );
  }

  @Put('notification-templates')
  @RequirePermission('users.settings.update')
  async updateNotificationTemplates(
    @Body() dto: UpdateNotificationTemplatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Record<string, NotificationTemplate>> {
    assertValidTemplates(dto.templates);
    // Sequential on purpose: each set() is its own upsert + audit row; a
    // multi-template PUT is N accountable writes, not one blob.
    for (const [suffix, template] of Object.entries(dto.templates)) {
      await this.settingsService.set(
        `${NOTIFICATION_TEMPLATE_KEY_PREFIX}${suffix}`,
        { subject: template.subject, bodyMarkdown: template.bodyMarkdown },
        user.userId,
      );
    }
    return this.getNotificationTemplates();
  }
}
