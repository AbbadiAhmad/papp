/**
 * D6/D7 (docs/DECISIONS.md), ARCHITECTURE.md §9, CLAUDE.md rule 4: Western
 * Arabic (Latin) digits and the Gregorian calendar EVERYWHERE, even in the
 * Arabic UI — `Intl.NumberFormat('ar')`/`Intl.DateTimeFormat('ar')` would
 * otherwise silently switch to Eastern Arabic-Indic digits / a non-Gregorian
 * calendar in some environments. Both pins are applied LAST (after any
 * caller-supplied options) so they can never be overridden by accident —
 * this is non-negotiable per CLAUDE.md, not a default.
 *
 * Manual verification (see this Developer agent's report for real output):
 *   new Intl.NumberFormat('ar', { numberingSystem: 'latn' }).format(1234)
 *   -> "1,234" (Western digits), never "١٬٢٣٤".
 */

export function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale, { ...options, numberingSystem: 'latn' }).format(value);
}

export function formatDate(
  value: Date | string | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory', numberingSystem: 'latn' }).format(date);
}

export function formatDateTime(value: Date | string | number, locale: string): string {
  return formatDate(value, locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(value: Date | string | number, locale: string): string {
  return formatDate(value, locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}
