import { NotificationTargetType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

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
}
