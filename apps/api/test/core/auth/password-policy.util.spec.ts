import { BadRequestException } from '@nestjs/common';
import { assertPasswordMeetsPolicy } from '../../../src/core/auth/password-policy.util';
import { PasswordPolicy } from '../../../src/core/settings/settings.types';

const POLICY: PasswordPolicy = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

describe('assertPasswordMeetsPolicy', () => {
  it('accepts a password that meets every rule', () => {
    expect(() => assertPasswordMeetsPolicy('abcdef12', POLICY)).not.toThrow();
  });

  it('accepts a password exactly at the minLength boundary', () => {
    // 8 chars, letter + digit present.
    expect(() => assertPasswordMeetsPolicy('abcdefg1', POLICY)).not.toThrow();
  });

  it('rejects a password one character short of minLength', () => {
    // 7 chars, would otherwise satisfy letter+digit.
    expect(() => assertPasswordMeetsPolicy('abcdef1', POLICY)).toThrow(BadRequestException);
  });

  it('rejects a password with no digit', () => {
    expect(() => assertPasswordMeetsPolicy('abcdefgh', POLICY)).toThrow(/at least one number/);
  });

  it('rejects a password with no letter', () => {
    expect(() => assertPasswordMeetsPolicy('12345678', POLICY)).toThrow(/at least one letter/);
  });

  it('reports every violated rule in one error message', () => {
    try {
      assertPasswordMeetsPolicy('a', POLICY);
      throw new Error('expected assertPasswordMeetsPolicy to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const message = (error as BadRequestException).message;
      expect(message).toMatch(/at least 8 characters/);
      expect(message).toMatch(/at least one number/);
    }
  });

  it('does not require a digit/letter when the policy turns those rules off', () => {
    const relaxed: PasswordPolicy = { ...POLICY, requireLetter: false, requireNumber: false };
    expect(() => assertPasswordMeetsPolicy('aaaaaaaa', relaxed)).not.toThrow();
    expect(() => assertPasswordMeetsPolicy('12345678', relaxed)).not.toThrow();
  });
});
