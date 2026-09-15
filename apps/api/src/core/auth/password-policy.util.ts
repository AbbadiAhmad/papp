import { BadRequestException } from '@nestjs/common';
import { PasswordPolicy } from '../settings/settings.types';

/**
 * Validates a candidate password against the current `auth.password_policy`
 * settings (read fresh via SettingsService by the caller — never hardcoded,
 * per D23). Throws a 400 listing every violated rule if it doesn't comply.
 */
export function assertPasswordMeetsPolicy(password: string, policy: PasswordPolicy): void {
  const violations: string[] = [];

  if (password.length < policy.minLength) {
    violations.push(`must be at least ${policy.minLength} characters long`);
  }
  if (policy.requireLetter && !/[A-Za-z]/.test(password)) {
    violations.push('must contain at least one letter');
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    violations.push('must contain at least one number');
  }

  if (violations.length > 0) {
    throw new BadRequestException(`Password does not meet policy: ${violations.join('; ')}`);
  }
}
