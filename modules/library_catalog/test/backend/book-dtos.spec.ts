import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from '@jest/globals';
import { CreateBookCopyDto } from '../../backend/dto/create-book-copy.dto';
import { CreateBookDto } from '../../backend/dto/create-book.dto';

/**
 * DTO validation, Tier 1 (docs/FEATURE_TEMPLATE.md §6 / D37) — direct
 * `validate()` calls against `class-validator`-decorated DTOs, no HTTP layer
 * involved. Matches the established style in
 * apps/api/test/core/settings/settings.controller.spec.ts (Phase 4): assert
 * on `errors[].property`/`errors[].constraints`, not just an error count.
 */

async function validateCreateBook(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateBookDto, payload));
}

async function validateCreateBookCopy(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateBookCopyDto, payload));
}

describe('CreateBookDto (class-validator)', () => {
  const validCopy = { qrCode: 'QR-0001' };

  it('accepts a payload with only the required title and copy', async () => {
    await expect(validateCreateBook({ title: 'Kalila wa Dimna', copy: validCopy })).resolves.toEqual([]);
  });

  it('accepts a full payload including every optional field', async () => {
    await expect(
      validateCreateBook({
        title: 'Kalila wa Dimna',
        author: 'Ibn al-Muqaffa',
        publisher: 'Dar al-Kutub',
        category: 'fiction',
        readingLevel: 'adult',
        language: 'ar',
        description: 'A classic collection of fables.',
        coverImage: 'https://example.com/cover.jpg',
        copy: validCopy,
      }),
    ).resolves.toEqual([]);
  });

  it('rejects a missing title', async () => {
    const errors = await validateCreateBook({ copy: validCopy });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('title');
    expect(errors[0].constraints).toHaveProperty('isString');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('rejects an empty-string title (MinLength(1))', async () => {
    const errors = await validateCreateBook({ title: '', copy: validCopy });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('title');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('rejects a non-string title', async () => {
    const errors = await validateCreateBook({ title: 12345, copy: validCopy });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('title');
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});

describe('CreateBookCopyDto (class-validator)', () => {
  it('accepts a payload with only the required qrCode (status defaults server-side)', async () => {
    await expect(validateCreateBookCopy({ qrCode: 'QR-0001' })).resolves.toEqual([]);
  });

  it('accepts every real status enum value from the migration', async () => {
    for (const status of ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved']) {
      await expect(validateCreateBookCopy({ qrCode: 'QR-0001', status })).resolves.toEqual([]);
    }
  });

  it('rejects a missing qrCode', async () => {
    const errors = await validateCreateBookCopy({});

    expect(errors.map((e) => e.property)).toContain('qrCode');
    const qrCodeError = errors.find((e) => e.property === 'qrCode');
    expect(qrCodeError?.constraints).toHaveProperty('isString');
    expect(qrCodeError?.constraints).toHaveProperty('minLength');
  });

  it('rejects an invalid copy status enum value', async () => {
    const errors = await validateCreateBookCopy({ qrCode: 'QR-0001', status: 'checked_out' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });

  it('rejects a non-date-string acquisitionDate', async () => {
    const errors = await validateCreateBookCopy({ qrCode: 'QR-0001', acquisitionDate: 'not-a-date' });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('acquisitionDate');
    expect(errors[0].constraints).toHaveProperty('isDateString');
  });
});
