/**
 * Parsing a pasted list of email addresses (survey ext. H). Import-free so the builder (cards with live
 * checking) and the server (the final say) use the same rules (SURVEY-D8).
 */

export const MAX_INVITES_PER_REQUEST = 200;
const EMAIL = /^[^\s@,;<>()[\]\\"]+@[^\s@,;<>()[\]\\"]+\.[^\s@,;<>()[\]\\"]{2,}$/;

export interface ParsedEmails {
  /** Valid, lower-cased, de-duplicated, in the order typed. */
  valid: string[];
  /** Things that are not an email address, as typed. */
  invalid: string[];
  /** Valid addresses typed more than once (reported once each). */
  duplicates: string[];
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/** Splits on commas, semicolons, spaces and new lines; accepts `Name <a@b.io>` pasted from a mail client. */
export function parseEmailList(input: string): ParsedEmails {
  const result: ParsedEmails = { valid: [], invalid: [], duplicates: [] };
  const seen = new Set<string>();
  // `Name <a@b.io>` pasted from a mail client: keep only the address (the name may contain spaces).
  const text = input.replace(/[^,;\n\r<>]*<([^<>\s]+)>/g, ' $1 ');
  for (const raw of text.split(/[\n\r,;\t ]+/)) {
    let token = raw.trim();
    if (!token) continue;
    token = token.replace(/^["']+|["']+$/g, '');
    if (!token) continue;
    if (!isValidEmail(token)) {
      result.invalid.push(raw.trim());
      continue;
    }
    const email = token.toLowerCase();
    if (seen.has(email)) {
      if (!result.duplicates.includes(email)) result.duplicates.push(email);
      continue;
    }
    seen.add(email);
    result.valid.push(email);
  }
  return result;
}
