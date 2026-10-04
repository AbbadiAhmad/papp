import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { RolesService } from '../roles/roles.service';
import { assertValidTemplates, UpdateNotificationTemplatesDto } from './dto/update-notification-templates.dto';
import { UpdatePasswordPolicyDto } from './dto/update-password-policy.dto';
import { UpdateRegistrationDto } from './dto/update-registration.dto';
import { UpdateSessionTimingDto } from './dto/update-session-timing.dto';
import { SettingsService } from './settings.service';
import {
  ALLOW_SELF_REGISTRATION_KEY,
  NOTIFICATION_TEMPLATE_KEY_PREFIX,
  NotificationTemplate,
  PASSWORD_POLICY_KEY,
  PasswordPolicy,
  SELF_REGISTRATION_ROLE_CODE_KEY,
  TOKEN_LIFETIMES_KEY,
  TokenLifetimes,
} from './settings.types';

/**
 * The core Settings tabs (ARCHITECTURE.md §6.3): Password Policy, Session
 * Timing, Notification Templates, and (Phase 5, D41) Self-Registration.
 * Permission-gated by `users.settings.view` / `users.settings.update` — NOT
 * hardcoded to admin (§7.4 stays the only role-name exception in the
 * codebase). Per §12.4, `notifications.templates.manage` is "effectively
 * users.settings.update", so the templates tab is gated by the same
 * users.settings.* codes as the others; the notifications.templates.manage
 * catalog entry exists (seeded in 0006, granted to admin) for a future finer
 * split. Self-registration is folded into this same controller/permission
 * pair rather than a bespoke `users.registration.*` code — it's exactly one
 * more Users-module admin-tunable boolean, same shape as the other three tabs.
 *
 * Auditing: NO `@Audit(...)` decorators here — deliberately. Every write
 * already produces its audit row inside `SettingsService.set()` (the Phase 3
 * retrofit: category 'core.settings', old/new value, @Sensitive-redacted).
 * Adding the interceptor on top would double-log every PUT (and N+1-log the
 * templates PUT). The controller's job is only to pass the caller's userId
 * through as `updatedBy`, which is what makes the service-level row an
 * actor_type='user' row instead of 'system'.
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are now
 * global (app.module.ts) — only `MustChangePasswordGuard` stays
 * controller-scoped (see its own docblock).
 */
@Controller('settings')
@UseGuards(MustChangePasswordGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly rolesService: RolesService,
  ) {}

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

  // --- Tab 4: Self-Registration (D41/D91) ----------------------------------

  @Get('registration')
  @RequirePermission('users.settings.view')
  async getRegistration(): Promise<{ allowSelfRegistration: boolean; selfRegistrationRoleCode: string | null }> {
    const allowSelfRegistration = await this.settingsService.get<boolean>(ALLOW_SELF_REGISTRATION_KEY);
    const selfRegistrationRoleCode = await this.settingsService.get<string | null>(SELF_REGISTRATION_ROLE_CODE_KEY);
    return { allowSelfRegistration, selfRegistrationRoleCode };
  }

  /**
   * D91: `selfRegistrationRoleCode` must reference a REAL role — checked
   * here against the `roles` table (never trusted as a bare string, since
   * `AuthService.register()` has no way to validate it again except at
   * registration time, when it's too late to give the admin a clear error).
   * Omitting the field from the body leaves the current value unchanged
   * (e.g. toggling `allowSelfRegistration` alone doesn't require re-sending
   * the role code every time).
   */
  @Put('registration')
  @RequirePermission('users.settings.update')
  async updateRegistration(
    @Body() dto: UpdateRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ allowSelfRegistration: boolean; selfRegistrationRoleCode: string | null }> {
    if (dto.selfRegistrationRoleCode !== undefined) {
      const role = await this.rolesService.findByCode(dto.selfRegistrationRoleCode);
      if (!role) {
        throw new BadRequestException(`No role with code "${dto.selfRegistrationRoleCode}" exists`);
      }
      await this.settingsService.set(SELF_REGISTRATION_ROLE_CODE_KEY, dto.selfRegistrationRoleCode, user.userId);
    }
    await this.settingsService.set(ALLOW_SELF_REGISTRATION_KEY, dto.allowSelfRegistration, user.userId);
    return this.getRegistration();
  }
}
