import { describe, expect, it } from '@jest/globals';
import { redactSensitive } from '../../../src/common/sensitive/sensitive-fields';

/**
 * `redactSensitive` contract (ARCHITECTURE.md §8.3 / D13): every key whose
 * NAME matches a `/// @Sensitive` schema field is replaced with
 * "[redacted]" — across ALL models and in hand-built diff objects alike
 * (deliberate over-redaction by name), at any nesting depth — and the output
 * is always JSON-plain, ready for a Prisma Json column.
 *
 * These tests run against the REAL generated DMMF, where `passwordHash`
 * (User) and `refreshTokenHash` (UserSession) are marked — the schema-scan
 * spec pins that precondition.
 */
describe('redactSensitive', () => {
  it('replaces a marked field at the top level and leaves other fields intact', () => {
    const result = redactSensitive({ id: 'u1', name: 'Amal', passwordHash: 'bcrypt$abc' });

    expect(result).toEqual({ id: 'u1', name: 'Amal', passwordHash: '[redacted]' });
  });

  it('replaces marked fields at any nesting depth', () => {
    const result = redactSensitive({
      user: { profile: { passwordHash: 'deep-secret' }, name: 'A' },
      session: { nested: { deeper: { refreshTokenHash: 'rt-secret' } } },
    });

    expect(result).toEqual({
      user: { profile: { passwordHash: '[redacted]' }, name: 'A' },
      session: { nested: { deeper: { refreshTokenHash: '[redacted]' } } },
    });
  });

  it('redacts inside arrays, including arrays of mixed content', () => {
    const result = redactSensitive([
      { refreshTokenHash: 'a', device: 'phone' },
      { name: 'plain' },
      'string-item',
      7,
    ]);

    expect(result).toEqual([
      { refreshTokenHash: '[redacted]', device: 'phone' },
      { name: 'plain' },
      'string-item',
      7,
    ]);
  });

  it('redacts the whole value even when a sensitive key holds an object, not a string', () => {
    const result = redactSensitive({ passwordHash: { algo: 'bcrypt', digest: 'abc' } });

    expect(result).toEqual({ passwordHash: '[redacted]' });
  });

  it('redacts a hand-built diff object by field NAME (cross-model contract, not per-entity)', () => {
    // Not a Prisma entity — a diff someone assembled by hand. The key name
    // alone must trigger redaction (D13: over-redaction beats a leak).
    const diff = { changed: { passwordHash: { from: 'old-hash', to: 'new-hash' } }, note: 'rotation' };

    expect(redactSensitive(diff)).toEqual({
      changed: { passwordHash: '[redacted]' },
      note: 'rotation',
    });
  });

  it('converts Date instances to ISO strings at every depth', () => {
    const result = redactSensitive({
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      nested: { seenAt: new Date('2025-12-31T23:59:59.000Z') },
    });

    expect(result).toEqual({
      createdAt: '2026-01-02T03:04:05.678Z',
      nested: { seenAt: '2025-12-31T23:59:59.000Z' },
    });
  });

  it('is safe on null, undefined and bare primitives', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeNull();
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
  });

  it('drops undefined object properties and stringifies bigint (JSON-plain normalization)', () => {
    const result = redactSensitive({ a: undefined, b: 1, big: 9007199254740993n });

    expect(result).toEqual({ b: 1, big: '9007199254740993' });
    expect(Object.keys(result as object)).not.toContain('a');
  });

  it('produces a JSON-plain structure: no Dates or class instances survive', () => {
    class Entity {
      id = 'u1';
      passwordHash = 'secret';
      updatedAt = new Date('2026-02-03T00:00:00.000Z');
    }

    const result = redactSensitive({ entity: new Entity(), when: new Date('2026-02-04T00:00:00.000Z') });

    // Round-trips through JSON without loss — exactly what a Prisma Json
    // column will do to it, so nothing may change in that trip.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const entity = (result as { entity: unknown }).entity;
    expect(Object.getPrototypeOf(entity)).toBe(Object.prototype);
    expect(entity).toEqual({ id: 'u1', passwordHash: '[redacted]', updatedAt: '2026-02-03T00:00:00.000Z' });
    expect((result as { when: unknown }).when).toBe('2026-02-04T00:00:00.000Z');
  });

  it('never mutates its input', () => {
    const input = { passwordHash: 'keep-me', nested: { refreshTokenHash: 'me-too' } };

    redactSensitive(input);

    expect(input).toEqual({ passwordHash: 'keep-me', nested: { refreshTokenHash: 'me-too' } });
  });
});
