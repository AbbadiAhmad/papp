import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SettingsController } from '../../../src/core/settings/settings.controller';
import {
  assertValidTemplates,
  UpdateNotificationTemplatesDto,
} from '../../../src/core/settings/dto/update-notification-templates.dto';
import { UpdatePasswordPolicyDto } from '../../../src/core/settings/dto/update-password-policy.dto';
import {
  NOTIFICATION_TEMPLATE_KEY_PREFIX,
  PASSWORD_POLICY_KEY,
} from '../../../src/core/settings/settings.types';

const VALID_POLICY = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

async function validatePolicy(payload: Record<string, unknown>) {
  return validate(plainToInstance(UpdatePasswordPolicyDto, payload));
}

describe('UpdatePasswordPolicyDto (class-validator)', () => {
  it('accepts a complete valid payload', async () => {
    await expect(validatePolicy(VALID_POLICY)).resolves.toEqual([]);
  });

  it('rejects minLength 0 (Min(1))', async () => {
    const errors = await validatePolicy({ ...VALID_POLICY, minLength: 0 });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('minLength');
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('rejects a non-integer minLength (string "8" and 7.5 both fail IsInt)', async () => {
    const stringErrors = await validatePolicy({ ...VALID_POLICY, minLength: '8' });
    expect(stringErrors).toHaveLength(1);
    expect(stringErrors[0].property).toBe('minLength');
    expect(stringErrors[0].constraints).toHaveProperty('isInt');

    const floatErrors = await validatePolicy({ ...VALID_POLICY, minLength: 7.5 });
    expect(floatErrors).toHaveLength(1);
    expect(floatErrors[0].constraints).toHaveProperty('isInt');
  });

  it('rejects non-boolean requireLetter and non-int lockoutMinutes', async () => {
    const errors = await validatePolicy({ ...VALID_POLICY, requireLetter: 'yes', lockoutMinutes: 'later' });

    const byProperty = Object.fromEntries(errors.map((e) => [e.property, e.constraints]));
    expect(byProperty.requireLetter).toHaveProperty('isBoolean');
    expect(byProperty.lockoutMinutes).toHaveProperty('isInt');
  });
});

describe('UpdateNotificationTemplatesDto + assertValidTemplates', () => {
  it('the DTO pins templates to be an object', async () => {
    const errors = await validate(plainToInstance(UpdateNotificationTemplatesDto, { templates: 'not-an-object' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('templates');
    expect(errors[0].constraints).toHaveProperty('isObject');
  });

  it('accepts a valid per-entry {subject, bodyMarkdown} map', () => {
    expect(() =>
      assertValidTemplates({
        password_reset: { subject: 'Reset', bodyMarkdown: 'Hi {{name}}' },
        force_password_change: { subject: 'Change it', bodyMarkdown: 'Now, {{name}}' },
      }),
    ).not.toThrow();
  });

  it('rejects an empty templates map', () => {
    expect(() => assertValidTemplates({})).toThrow(BadRequestException);
  });

  it('rejects a key that is not a lowercase suffix', () => {
    expect(() => assertValidTemplates({ 'Bad Key!': { subject: 's', bodyMarkdown: 'b' } })).toThrow(BadRequestException);
    expect(() =>
      assertValidTemplates({ 'notifications.templates.password_reset': { subject: 's', bodyMarkdown: 'b' } }),
    ).toThrow(/lowercase suffixes/);
  });

  it('rejects a non-object entry and a missing/empty subject or bodyMarkdown', () => {
    expect(() => assertValidTemplates({ password_reset: 'nope' })).toThrow(BadRequestException);
    expect(() => assertValidTemplates({ password_reset: null })).toThrow(BadRequestException);
    expect(() => assertValidTemplates({ password_reset: { bodyMarkdown: 'b' } })).toThrow(/non-empty string subject/);
    expect(() => assertValidTemplates({ password_reset: { subject: '   ', bodyMarkdown: 'b' } })).toThrow(
      /non-empty string subject/,
    );
    expect(() => assertValidTemplates({ password_reset: { subject: 's' } })).toThrow(/non-empty string bodyMarkdown/);
    expect(() => assertValidTemplates({ password_reset: { subject: 's', bodyMarkdown: '' } })).toThrow(
      /non-empty string bodyMarkdown/,
    );
  });

  it('rejects unknown extra fields on an entry', () => {
    expect(() =>
      assertValidTemplates({ password_reset: { subject: 's', bodyMarkdown: 'b', html: '<b>no</b>' } }),
    ).toThrow(/unknown field\(s\): html/);
  });
});

describe('SettingsController', () => {
  let settingsService: { get: jest.Mock; set: jest.Mock; getManyByPrefix: jest.Mock };
  let controller: SettingsController;
  const admin = { userId: 'admin-1' };

  beforeEach(() => {
    settingsService = { get: jest.fn(), set: jest.fn(), getManyByPrefix: jest.fn() };
    settingsService.set.mockResolvedValue(undefined);
    controller = new SettingsController(settingsService as never);
  });

  it('PUT password-policy calls set() with the right key, the full payload, and the caller as updatedBy', async () => {
    settingsService.get.mockResolvedValue(VALID_POLICY);
    const dto = plainToInstance(UpdatePasswordPolicyDto, VALID_POLICY);

    const result = await controller.updatePasswordPolicy(dto, admin as never);

    expect(settingsService.set).toHaveBeenCalledWith(PASSWORD_POLICY_KEY, VALID_POLICY, 'admin-1');
    // Returns the freshly re-read value, not an echo of the input object.
    expect(settingsService.get).toHaveBeenCalledWith(PASSWORD_POLICY_KEY);
    expect(result).toEqual(VALID_POLICY);
  });

  it('PUT notification-templates writes one prefixed set() per entry with only {subject, bodyMarkdown}', async () => {
    settingsService.getManyByPrefix.mockResolvedValue({
      [`${NOTIFICATION_TEMPLATE_KEY_PREFIX}password_reset`]: { subject: 'Reset', bodyMarkdown: 'Hi {{name}}' },
    });
    const dto = {
      templates: {
        password_reset: { subject: 'Reset', bodyMarkdown: 'Hi {{name}}' },
        force_password_change: { subject: 'Change', bodyMarkdown: 'Now' },
      },
    } as UpdateNotificationTemplatesDto;

    const result = await controller.updateNotificationTemplates(dto, admin as never);

    expect(settingsService.set).toHaveBeenCalledTimes(2);
    expect(settingsService.set).toHaveBeenCalledWith(
      'notifications.templates.password_reset',
      { subject: 'Reset', bodyMarkdown: 'Hi {{name}}' },
      'admin-1',
    );
    expect(settingsService.set).toHaveBeenCalledWith(
      'notifications.templates.force_password_change',
      { subject: 'Change', bodyMarkdown: 'Now' },
      'admin-1',
    );
    // Response is keyed by SUFFIX (prefix stripped).
    expect(result).toEqual({ password_reset: { subject: 'Reset', bodyMarkdown: 'Hi {{name}}' } });
  });

  it('PUT notification-templates rejects an invalid entry before any set()', async () => {
    const dto = { templates: { password_reset: { subject: '', bodyMarkdown: 'b' } } } as never;

    await expect(controller.updateNotificationTemplates(dto, admin as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(settingsService.set).not.toHaveBeenCalled();
  });
});
