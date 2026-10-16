import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Personal invitation links and the emails around them (survey ext. H, SURVEY-D22).
 *
 * The link token is `<invitation id>.<HMAC-SHA256(id, server secret)>`: nothing secret is stored in the database,
 * a reminder re-sends the identical link, and deleting the invitation revokes it. Changing the server secret
 * (JWT_SECRET) invalidates every outstanding link.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET is not set; invitation links cannot be signed');
  return `survey-invite:${value}`;
}

export function inviteSignature(invitationId: string): string {
  return createHmac('sha256', secret()).update(invitationId.toLowerCase()).digest('hex').slice(0, 40);
}

export function makeInviteToken(invitationId: string): string {
  return `${invitationId.toLowerCase()}.${inviteSignature(invitationId)}`;
}

/** The invitation id inside a genuine token, or null for anything else (wrong shape, wrong signature). */
export function readInviteToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const [id, signature, ...rest] = token.split('.');
  if (rest.length > 0 || !id || !signature || !UUID.test(id)) return null;
  const expected = Buffer.from(inviteSignature(id));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id.toLowerCase() : null;
}

/** Where respondents open the survey: APP_PUBLIC_URL, else the first WEB_ORIGIN (same list the CORS setup reads). */
export function appPublicUrl(): string | null {
  const configured = process.env.APP_PUBLIC_URL?.trim() || process.env.WEB_ORIGIN?.split(',').map((o) => o.trim()).find(Boolean) || '';
  if (!configured) return process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173';
  return configured.replace(/\/+$/, '');
}

export function inviteLink(base: string, surveyId: string, invitationId: string): string {
  return `${base}/survey/${surveyId}?invite=${encodeURIComponent(makeInviteToken(invitationId))}`;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface MailParts {
  subject: string;
  text: string;
  html: string;
}

/** Invitation or reminder. The survey title is plain text here (formatting markup is stripped by the caller). */
export function buildInviteMail(opts: { title: string; link: string; reminder: boolean; closesAt?: Date | null }): MailParts {
  const closing = opts.closesAt ? opts.closesAt.toISOString().slice(0, 10) : null;
  const subject = opts.reminder ? `Reminder: ${opts.title} / تذكير: ${opts.title}` : `You are invited: ${opts.title} / دعوة: ${opts.title}`;
  const textLines = [
    opts.reminder ? 'This is a reminder: you have not answered this survey yet.' : 'You are invited to answer a survey.',
    opts.title,
    closing ? `Open until: ${closing}` : '',
    opts.link,
    '',
    opts.reminder ? 'هذا تذكير: لم تُجب بعد على هذا الاستبيان.' : 'تمت دعوتك للإجابة على استبيان.',
    closing ? `متاح حتى: ${closing}` : '',
    'This link is personal; please do not forward it. / هذا الرابط شخصي، يرجى عدم تمريره.',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');
  const html = `<p>${escapeHtml(textLines[0])}</p><p><strong>${escapeHtml(opts.title)}</strong></p>${closing ? `<p>Open until: ${closing}</p>` : ''}<p><a href="${escapeHtml(opts.link)}">${escapeHtml(opts.link)}</a></p><p dir="rtl">${escapeHtml(opts.reminder ? 'هذا تذكير: لم تُجب بعد على هذا الاستبيان.' : 'تمت دعوتك للإجابة على استبيان.')}</p><p><small>This link is personal; please do not forward it. / هذا الرابط شخصي، يرجى عدم تمريره.</small></p>`;
  return { subject, text: textLines.join('\n'), html };
}

/** A respondent's emailed copy of their own answers. */
export function buildCopyMail(opts: { title: string; submittedAt: Date; rows: Array<{ question: string; answer: string }> }): MailParts {
  const subject = `Your answers: ${opts.title} / إجاباتك: ${opts.title}`;
  const text = [
    `Thank you. This is a copy of your answers to "${opts.title}" (${opts.submittedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC).`,
    'شكرًا لك. هذه نسخة من إجاباتك.',
    '',
    ...opts.rows.map((r) => `${r.question}\n  ${r.answer || '-'}`),
  ].join('\n');
  const html = `<p>Thank you. This is a copy of your answers to <strong>${escapeHtml(opts.title)}</strong>.</p><p dir="rtl">شكرًا لك. هذه نسخة من إجاباتك.</p><table cellpadding="6" style="border-collapse:collapse">${opts.rows
    .map((r) => `<tr><td style="border-bottom:1px solid #ddd;vertical-align:top"><strong>${escapeHtml(r.question)}</strong></td><td style="border-bottom:1px solid #ddd">${escapeHtml(r.answer || '-')}</td></tr>`)
    .join('')}</table>`;
  return { subject, text, html };
}
