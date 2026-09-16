import { describe, expect, it } from 'vitest';
import { formatDate, formatDateOnly, formatDateTime, formatNumber } from '../src/shared/format';

/**
 * D6/D7 (docs/DECISIONS.md), CLAUDE.md rule 4: Western Arabic (Latin) digits
 * and the Gregorian calendar everywhere, even in the Arabic UI. These tests
 * verify the pins in `shared/format.ts` actually hold — including that they
 * cannot be defeated by a caller-supplied option — rather than just trusting
 * the docblock's manual-verification note.
 */
const EASTERN_ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('formatNumber', () => {
  it('renders Western digits for the Arabic locale', () => {
    const result = formatNumber(1234567, 'ar');
    expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
    expect(result.replace(/[^0-9]/g, '')).toBe('1234567');
  });

  it('renders Western digits for regional Arabic locales too (ar-EG, ar-SA)', () => {
    for (const locale of ['ar-EG', 'ar-SA']) {
      const result = formatNumber(9876, locale);
      expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
    }
  });

  it('produces the same digit stream as the English locale for the same value', () => {
    const ar = formatNumber(1234, 'ar');
    const en = formatNumber(1234, 'en');
    expect(ar.replace(/[^0-9-]/g, '')).toBe(en.replace(/[^0-9-]/g, ''));
  });

  it('handles zero', () => {
    expect(formatNumber(0, 'ar')).toBe('0');
  });

  it('handles negative numbers with a Latin minus sign', () => {
    const result = formatNumber(-42, 'ar');
    expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
    expect(result).toContain('-');
    expect(result).toContain('42');
  });

  it('handles large numbers with grouping separators intact', () => {
    const result = formatNumber(1_234_567, 'ar');
    expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
    expect(result.replace(/[^0-9]/g, '')).toBe('1234567');
  });

  it('a caller-supplied numberingSystem can never override the pinned "latn"', () => {
    // formatNumber spreads caller options BEFORE pinning numberingSystem, so
    // this must have no effect — verifying the "pinned LAST" docblock claim.
    const result = formatNumber(1234, 'ar', { numberingSystem: 'arab' } as Intl.NumberFormatOptions);
    expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
  });
});

describe('formatDate / formatDateOnly / formatDateTime', () => {
  // 2024-03-01 is Gregorian year 2024 / roughly Hijri year 1445 — a good
  // canary for "did this silently switch calendar systems".
  const knownDate = new Date(Date.UTC(2024, 2, 1, 13, 30));

  it('renders the Gregorian year for the Arabic locale, never the Hijri year', () => {
    const result = formatDateOnly(knownDate, 'ar');
    expect(result).toContain('2024');
    expect(result).not.toContain('1445');
  });

  it('never renders Eastern Arabic-Indic digits for the Arabic locale', () => {
    expect(formatDateOnly(knownDate, 'ar')).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
    expect(formatDateTime(knownDate, 'ar')).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
  });

  it('renders the same Gregorian year for the English locale (comparison case)', () => {
    expect(formatDateOnly(knownDate, 'en')).toContain('2024');
  });

  it('formatDateTime includes a Gregorian date and time for both locales', () => {
    const ar = formatDateTime(knownDate, 'ar');
    const en = formatDateTime(knownDate, 'en');
    expect(ar).toContain('2024');
    expect(en).toContain('2024');
    expect(ar).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
  });

  it('accepts an ISO string and a numeric timestamp identically to a Date instance', () => {
    const iso = knownDate.toISOString();
    const timestamp = knownDate.getTime();
    expect(formatDateOnly(iso, 'ar')).toBe(formatDateOnly(knownDate, 'ar'));
    expect(formatDateOnly(timestamp, 'ar')).toBe(formatDateOnly(knownDate, 'ar'));
  });

  it('a caller-supplied calendar/numberingSystem can never override the pinned Gregorian/Latin ones', () => {
    const result = formatDate(knownDate, 'ar', {
      calendar: 'islamic',
      numberingSystem: 'arab',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    } as Intl.DateTimeFormatOptions);
    expect(result).toContain('2024');
    expect(result).not.toMatch(EASTERN_ARABIC_INDIC_DIGITS);
  });
});
