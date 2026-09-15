import { BadRequestException } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { NotificationTemplate } from '../settings.types';

/**
 * PUT /settings/notification-templates body:
 *
 *   { "templates": { "password_reset": { "subject": "...", "bodyMarkdown": "..." }, ... } }
 *
 * Keys are template SUFFIXES (the part after `notifications.templates.`).
 * The map shape is dynamic (an admin may add future template keys), which
 * class-validator's static decorators can't express — so the DTO only pins
 * "templates is an object" and `assertValidTemplates` does the per-entry
 * shape validation explicitly.
 */
export class UpdateNotificationTemplatesDto {
  @IsObject()
  templates!: Record<string, NotificationTemplate>;
}

const TEMPLATE_KEY_PATTERN = /^[a-z0-9_-]+$/;

export function assertValidTemplates(templates: Record<string, unknown>): asserts templates is Record<string, NotificationTemplate> {
  const entries = Object.entries(templates);
  if (entries.length === 0) {
    throw new BadRequestException('templates must contain at least one entry');
  }
  for (const [key, value] of entries) {
    if (!TEMPLATE_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        `Invalid template key "${key}" — keys are lowercase suffixes like "password_reset" (the "notifications.templates." prefix is added server-side)`,
      );
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`Template "${key}" must be an object with subject and bodyMarkdown`);
    }
    const { subject, bodyMarkdown, ...rest } = value as Record<string, unknown>;
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      throw new BadRequestException(`Template "${key}" needs a non-empty string subject`);
    }
    if (typeof bodyMarkdown !== 'string' || bodyMarkdown.trim().length === 0) {
      throw new BadRequestException(`Template "${key}" needs a non-empty string bodyMarkdown`);
    }
    const extraKeys = Object.keys(rest);
    if (extraKeys.length > 0) {
      throw new BadRequestException(`Template "${key}" has unknown field(s): ${extraKeys.join(', ')}`);
    }
  }
}
