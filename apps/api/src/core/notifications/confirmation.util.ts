import { createHash, randomBytes } from 'crypto';

/** A fresh unguessable link token (256 bits); only its hash is ever stored. */
export function generateConfirmationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashConfirmationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** SHA-256 of the exact text the confirmer was shown (title + body), for tamper evidence. */
export function contentHash(title: string, bodyMarkdown: string): string {
  return createHash('sha256').update(`${title}\n\n${bodyMarkdown}`, 'utf8').digest('hex');
}

/** Where people open the app: APP_PUBLIC_URL, else the first WEB_ORIGIN; null in production when neither is set. */
export function appPublicUrl(): string | null {
  const configured =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.WEB_ORIGIN?.split(',').map((o) => o.trim()).find(Boolean) ||
    '';
  if (!configured) return process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173';
  return configured.replace(/\/+$/, '');
}

export function confirmationLink(base: string, token: string): string {
  return `${base}/notifications/confirm/${encodeURIComponent(token)}`;
}
