import { NotificationTargetType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * POST /notifications body (D21): target is a platform user, a role (its
 * CURRENT holders at send time), or all users — never an external address,
 * which is why `targetId` is a UUID and there is no email field at all.
 * The user/role-vs-all_users targetId shape rule is enforced in
 * NotificationsService.assertTargetShape (it depends on targetType, which
 * class-validator's static decorators can't express cleanly).
 */
export class SendNotificationDto {
  @IsString()
  @MinLength(1)
  category!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  /** Markdown SOURCE — rendered to sanitized HTML at send/display time only. */
  @IsString()
  @MinLength(1)
  bodyMarkdown!: string;

  @IsEnum(NotificationTargetType)
  targetType!: NotificationTargetType;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  /**
   * Role targets only: several roles at once. Recipients are the UNION of
   * the roles' current holders (a user holding two selected roles gets one
   * notice). When present it takes the place of `targetId`.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  targetIds?: string[];

  /**
   * Extra platform users added on top of the target (any target type): the final
   * recipients are the union, each user once. Named explicitly, so inactive users are honored.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  extraUserIds?: string[];

  /**
   * External addresses (people with no account) added on top of the target. They are
   * emailed only — no inbox row, no confirmation link — so they cannot be combined with
   * `requiresConfirmation`.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsEmail({}, { each: true })
  extraEmails?: string[];

  /**
   * D119: when true, every recipient is emailed a personal link to confirm
   * receipt / acceptance; the confirmation is stored as evidence.
   */
  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;

  /** Evidence label, e.g. 'receipt' (default), 'policy_acceptance', 'gdpr_consent'. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  confirmationType?: string;

  @IsOptional()
  @IsBoolean()
  confirmationAllowComment?: boolean;
}
