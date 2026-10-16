/**
 * Conversions between the server's ISO date-times and the value of an
 * `<input type="datetime-local">` (local time, `YYYY-MM-DDTHH:mm`). Kept apart
 * (pure, no React) so the time-zone handling is unit-tested.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string (UTC) -> the local `YYYY-MM-DDTHH:mm` an input shows. Empty for null/invalid. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local input value -> ISO string (UTC), or null when blank/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
