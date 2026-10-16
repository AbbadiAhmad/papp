import { describe, expect, it } from '@jest/globals';
import { MAX_RESPONSE_LIMIT, MAX_THANK_YOU_LENGTH, computeAvailability, normalizeSettings, validateSurveyOptions } from '../../backend/survey-settings';

describe('normalizeSettings', () => {
  it('keeps only known keys, trims the message and drops empty values', () => {
    expect(normalizeSettings({ thankYouMessage: '  Thanks!  ', showProgressBar: true, evil: 1 })).toEqual({ thankYouMessage: 'Thanks!', showProgressBar: true });
    expect(normalizeSettings({ thankYouMessage: '   ', showProgressBar: false })).toEqual({});
  });

  it('tolerates garbage (null, arrays, wrong types) by returning empty settings', () => {
    for (const bad of [null, undefined, 5, 'x', [], { thankYouMessage: 7, showProgressBar: 'yes' }]) expect(normalizeSettings(bad)).toEqual({});
  });

  it('truncates an over-long message instead of failing (a stored value can never break a page)', () => {
    expect(normalizeSettings({ thankYouMessage: 'x'.repeat(MAX_THANK_YOU_LENGTH + 50) }).thankYouMessage).toHaveLength(MAX_THANK_YOU_LENGTH);
  });
});

describe('validateSurveyOptions', () => {
  it('accepts valid and absent values', () => {
    expect(validateSurveyOptions({})).toBeNull();
    expect(validateSurveyOptions({ responseLimit: 50, thankYouMessage: 'ok', opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-02-01T00:00:00Z' })).toBeNull();
    expect(validateSurveyOptions({ responseLimit: null, opensAt: null, closesAt: null })).toBeNull();
  });

  it('rejects a bad response limit', () => {
    for (const bad of [0, -1, 1.5, MAX_RESPONSE_LIMIT + 1, '10']) expect(validateSurveyOptions({ responseLimit: bad })).toMatch(/response limit/);
  });

  it('rejects an over-long thank-you message', () => {
    expect(validateSurveyOptions({ thankYouMessage: 'x'.repeat(MAX_THANK_YOU_LENGTH + 1) })).toMatch(/too long/);
  });

  it('rejects an invalid date and a closing date that is not after the opening date', () => {
    expect(validateSurveyOptions({ opensAt: 'not a date' })).toMatch(/not valid/);
    expect(validateSurveyOptions({ opensAt: '2026-02-01T00:00:00Z', closesAt: '2026-02-01T00:00:00Z' })).toMatch(/after the opening/);
    expect(validateSurveyOptions({ opensAt: '2026-03-01T00:00:00Z', closesAt: '2026-02-01T00:00:00Z' })).toMatch(/after the opening/);
  });
});

describe('computeAvailability', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const published = { status: 'published' as const };

  it('is null unless the survey is published (draft/closed have their own status)', () => {
    expect(computeAvailability({ status: 'draft' }, 0, now)).toBeNull();
    expect(computeAvailability({ status: 'closed' }, 0, now)).toBeNull();
  });

  it('is open with no schedule and no cap', () => {
    expect(computeAvailability(published, 999, now)).toBe('open');
  });

  it('is not_open_yet before opensAt and open from the exact opening moment', () => {
    expect(computeAvailability({ ...published, opensAt: '2026-06-15T12:00:01Z' }, 0, now)).toBe('not_open_yet');
    expect(computeAvailability({ ...published, opensAt: '2026-06-15T12:00:00Z' }, 0, now)).toBe('open');
  });

  it('is ended from the exact closing moment', () => {
    expect(computeAvailability({ ...published, closesAt: '2026-06-15T12:00:01Z' }, 0, now)).toBe('open');
    expect(computeAvailability({ ...published, closesAt: '2026-06-15T12:00:00Z' }, 0, now)).toBe('ended');
  });

  it('is full when the count reaches the limit, and open one below it', () => {
    expect(computeAvailability({ ...published, responseLimit: 10 }, 9, now)).toBe('open');
    expect(computeAvailability({ ...published, responseLimit: 10 }, 10, now)).toBe('full');
    expect(computeAvailability({ ...published, responseLimit: null }, 10_000, now)).toBe('open');
  });

  it('reports the schedule before the cap when both apply', () => {
    expect(computeAvailability({ ...published, opensAt: '2027-01-01T00:00:00Z', responseLimit: 1 }, 5, now)).toBe('not_open_yet');
    expect(computeAvailability({ ...published, closesAt: '2026-01-01T00:00:00Z', responseLimit: 1 }, 5, now)).toBe('ended');
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(computeAvailability({ ...published, closesAt: new Date('2026-01-01T00:00:00Z') }, 0, now)).toBe('ended');
  });
});
