import { describe, expect, it } from 'vitest';
import { fromLocalInput, toLocalInput } from '../../frontend/schedule';

describe('schedule input conversion', () => {
  it('round-trips a moment through the local input value', () => {
    const iso = '2026-06-15T09:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('shows the local wall-clock time and zero-pads every part', () => {
    const local = new Date(2026, 0, 5, 7, 4); // 5 Jan 2026 07:04 in the machine's zone
    expect(toLocalInput(local.toISOString())).toBe('2026-01-05T07:04');
    expect(fromLocalInput('2026-01-05T07:04')).toBe(local.toISOString());
  });

  it('treats blank and invalid values as "not set"', () => {
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput('nope')).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('nope')).toBeNull();
  });
});
