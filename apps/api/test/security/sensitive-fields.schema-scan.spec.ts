import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';
import {
  getSensitiveFieldNames,
  getSensitiveFieldsByModel,
} from '../../src/common/sensitive/sensitive-fields';

/**
 * THE schema-scan test (docs/TESTING_STRATEGY.md §3): enumerate every Prisma
 * field whose NAME looks secret-bearing and fail the build if it is not
 * marked with the `/// @Sensitive` doc-comment. This is pure DMMF
 * introspection — no DB — so it is Tier 1 (§0) despite touching the schema.
 *
 * The scan is deliberately implemented here as a pure function over
 * DMMF-shaped input so the MECHANISM itself is testable against synthetic
 * models (a scan that only ever ran against today's schema would prove
 * nothing about tomorrow's forgotten field).
 */

/** Name patterns from TESTING_STRATEGY.md §3, tuned against the real schema. */
const SENSITIVE_NAME_PATTERNS: readonly RegExp[] = [/password/i, /hash/i, /token/i, /secret/i];

/**
 * Only types that can physically carry a secret are candidates. This is the
 * "tuned against the real schema" part: `User.mustChangePassword` matches
 * /password/i but is a Boolean flag — a Boolean cannot leak a credential, so
 * non-secret-capable types are excluded rather than allowlisted one by one.
 */
const SECRET_CAPABLE_TYPES: ReadonlySet<string> = new Set(['String', 'Json', 'Bytes']);

/**
 * Escape hatch for a future secret-capable field whose name merely LOOKS
 * sensitive (e.g. a hypothetical `colorHashtag`). Entries are `Model.field`.
 * Empty today — adding to it must be a reviewed, deliberate act.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

interface DmmfLikeField {
  readonly name: string;
  readonly kind: string;
  readonly type: string;
  readonly documentation?: string;
}

interface DmmfLikeModel {
  readonly name: string;
  readonly fields: readonly DmmfLikeField[];
}

/** Returns `Model.field` for every sensitive-looking field missing `/// @Sensitive`. */
function findUnmarkedSensitiveFields(models: readonly DmmfLikeModel[]): string[] {
  const violations: string[] = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== 'scalar') continue;
      if (!SECRET_CAPABLE_TYPES.has(field.type)) continue;
      if (!SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(field.name))) continue;
      if (ALLOWLIST.has(`${model.name}.${field.name}`)) continue;
      if (field.documentation?.includes('@Sensitive')) continue;
      violations.push(`${model.name}.${field.name}`);
    }
  }
  return violations;
}

describe('@Sensitive schema scan (TESTING_STRATEGY.md §3)', () => {
  describe('against the real Prisma schema', () => {
    it('finds NO sensitive-looking field that lacks the /// @Sensitive marker', () => {
      const violations = findUnmarkedSensitiveFields(Prisma.dmmf.datamodel.models);

      // A non-empty list here is a build-blocking security bug: the named
      // field would be written UN-REDACTED into audit_log old/new values.
      // Fix: add `/// @Sensitive` above the field in prisma/schema.prisma
      // (or, only for a genuine false positive, allowlist it above).
      expect(violations).toEqual([]);
    });

    it('has User.passwordHash and UserSession.refreshTokenHash marked @Sensitive', () => {
      const byModel = getSensitiveFieldsByModel();

      expect(byModel.get('User')).toBeDefined();
      expect(byModel.get('User')?.has('passwordHash')).toBe(true);
      expect(byModel.get('UserSession')).toBeDefined();
      expect(byModel.get('UserSession')?.has('refreshTokenHash')).toBe(true);
    });

    it('exposes both marked field names in the cross-model redaction name set', () => {
      const names = getSensitiveFieldNames();

      expect(names.has('passwordHash')).toBe(true);
      expect(names.has('refreshTokenHash')).toBe(true);
    });
  });

  describe('the scan mechanism itself (synthetic DMMF models)', () => {
    const field = (overrides: Partial<DmmfLikeField> & { name: string }): DmmfLikeField => ({
      kind: 'scalar',
      type: 'String',
      ...overrides,
    });

    it('catches an unmarked String field whose name matches a sensitive pattern', () => {
      const models: DmmfLikeModel[] = [
        { name: 'ApiClient', fields: [field({ name: 'apiToken' }), field({ name: 'label' })] },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual(['ApiClient.apiToken']);
    });

    it('catches every pattern family: password, hash, token, secret', () => {
      const models: DmmfLikeModel[] = [
        {
          name: 'Leaky',
          fields: [
            field({ name: 'password' }),
            field({ name: 'contentHash' }),
            field({ name: 'resetToken' }),
            field({ name: 'clientSecret' }),
          ],
        },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual([
        'Leaky.password',
        'Leaky.contentHash',
        'Leaky.resetToken',
        'Leaky.clientSecret',
      ]);
    });

    it('accepts the same field once it carries the /// @Sensitive doc-comment', () => {
      const models: DmmfLikeModel[] = [
        { name: 'ApiClient', fields: [field({ name: 'apiToken', documentation: '@Sensitive' })] },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual([]);
    });

    it('ignores non-secret-capable types (the User.mustChangePassword Boolean case)', () => {
      const models: DmmfLikeModel[] = [
        {
          name: 'User',
          fields: [field({ name: 'mustChangePassword', type: 'Boolean' }), field({ name: 'tokenCount', type: 'Int' })],
        },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual([]);
    });

    it('ignores relation (non-scalar) fields even when the name matches', () => {
      const models: DmmfLikeModel[] = [
        { name: 'User', fields: [field({ name: 'passwordResets', kind: 'object', type: 'PasswordReset' })] },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual([]);
    });

    it('does not flag fields with unrelated names', () => {
      const models: DmmfLikeModel[] = [
        { name: 'Book', fields: [field({ name: 'title' }), field({ name: 'isbn' })] },
      ];

      expect(findUnmarkedSensitiveFields(models)).toEqual([]);
    });
  });
});
