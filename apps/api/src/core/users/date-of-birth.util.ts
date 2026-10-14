const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST = '1900-01-01';

/**
 * Normalizes a date-of-birth string to `YYYY-MM-DD`, or returns null when it
 * is not a real calendar date, is before 1900 or lies in the future.
 */
export function normalizeDateOfBirth(input: string, today: Date = new Date()): string | null {
  const text = input.trim();
  if (!ISO_DATE.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return null; // e.g. 2020-02-31
  if (text < EARLIEST || text > today.toISOString().slice(0, 10)) return null;
  return text;
}

/** A normalized `YYYY-MM-DD` string as the Date a `@db.Date` column expects. */
export function toDateOnly(normalized: string): Date {
  return new Date(`${normalized}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
