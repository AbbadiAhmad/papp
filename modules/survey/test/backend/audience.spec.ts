import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isValidEmail, MAX_INVITES_PER_REQUEST, parseEmailList } from '../../backend/email-list';
import { appPublicUrl, buildCopyMail, buildInviteMail, inviteLink, makeInviteToken, readInviteToken } from '../../backend/invitations';

const ID = '5b2f1d0e-1111-4222-8333-444455556666';

describe('parseEmailList', () => {
  it('splits on commas, semicolons, spaces and new lines; lower-cases and de-duplicates', () => {
    expect(parseEmailList('A@x.io, b@x.io;c@x.io\nd@x.io   a@X.io')).toEqual({ valid: ['a@x.io', 'b@x.io', 'c@x.io', 'd@x.io'], invalid: [], duplicates: ['a@x.io'] });
  });
  it('reports what is not an address, as typed, and keeps going', () => {
    const r = parseEmailList('ok@x.io, nope, @x.io, a@b, two@@x.io, spaces in@x.io');
    expect(r.valid).toEqual(['ok@x.io', 'in@x.io']);
    expect(r.invalid).toEqual(['nope', '@x.io', 'a@b', 'two@@x.io', 'spaces']);
  });
  it('understands "Name <address>" pasted from a mail client, and quotes', () => {
    expect(parseEmailList('Ann Lee <ann@x.io>, "bob@x.io"').valid).toEqual(['ann@x.io', 'bob@x.io']);
  });
  it('rejects script-like and over-long input', () => {
    expect(isValidEmail('a@b.io')).toBe(true);
    expect(isValidEmail('<script>@x.io')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@x.io`)).toBe(false);
    expect(parseEmailList('').valid).toEqual([]);
    expect(MAX_INVITES_PER_REQUEST).toBeGreaterThan(0);
  });
});

describe('invitation tokens', () => {
  const saved = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });
  afterEach(() => {
    process.env.JWT_SECRET = saved;
  });

  it('round-trips an invitation id and is stable (a reminder re-sends the same link)', () => {
    const token = makeInviteToken(ID);
    expect(readInviteToken(token)).toBe(ID);
    expect(makeInviteToken(ID)).toBe(token);
    expect(readInviteToken(makeInviteToken(ID.toUpperCase()))).toBe(ID);
  });
  it('rejects tampered, truncated, extended and foreign-secret tokens', () => {
    const token = makeInviteToken(ID);
    expect(readInviteToken(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`)).toBeNull();
    expect(readInviteToken(token.slice(0, -2))).toBeNull();
    expect(readInviteToken(`${token}.extra`)).toBeNull();
    expect(readInviteToken(`${ID}.`)).toBeNull();
    expect(readInviteToken('not-a-uuid.abcdef')).toBeNull();
    expect(readInviteToken(undefined)).toBeNull();
    expect(readInviteToken('x'.repeat(500))).toBeNull();
    process.env.JWT_SECRET = 'another-secret';
    expect(readInviteToken(token)).toBeNull();
  });
  it('refuses to sign without a server secret', () => {
    delete process.env.JWT_SECRET;
    expect(() => makeInviteToken(ID)).toThrow();
  });
});

describe('links and emails', () => {
  it('builds the public base URL from APP_PUBLIC_URL, else the first WEB_ORIGIN, with no trailing slash', () => {
    const saved = { a: process.env.APP_PUBLIC_URL, w: process.env.WEB_ORIGIN, n: process.env.NODE_ENV };
    process.env.APP_PUBLIC_URL = 'https://library.example.org/';
    expect(appPublicUrl()).toBe('https://library.example.org');
    delete process.env.APP_PUBLIC_URL;
    process.env.WEB_ORIGIN = 'https://a.example.org, https://b.example.org';
    expect(appPublicUrl()).toBe('https://a.example.org');
    delete process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(appPublicUrl()).toBeNull();
    process.env.NODE_ENV = 'development';
    expect(appPublicUrl()).toBe('http://localhost:5173');
    Object.assign(process.env, { APP_PUBLIC_URL: saved.a, WEB_ORIGIN: saved.w, NODE_ENV: saved.n });
  });

  it('the invitation mail carries the personal link, is bilingual and escapes the title in HTML', () => {
    process.env.JWT_SECRET = 'unit-test-secret';
    const link = inviteLink('https://app.example', 'sid', ID);
    expect(link).toMatch(/^https:\/\/app\.example\/survey\/sid\?invite=/);
    const mail = buildInviteMail({ title: '<b>Reader</b> & "survey"', link, reminder: false, closesAt: new Date('2026-12-01T00:00:00Z') });
    expect(mail.subject).toContain('دعوة');
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('2026-12-01');
    expect(mail.html).toContain('&lt;b&gt;Reader&lt;/b&gt; &amp; &quot;survey&quot;');
    expect(mail.html).not.toContain('<b>Reader</b>');
    expect(buildInviteMail({ title: 'T', link, reminder: true }).subject).toMatch(/^Reminder/);
  });

  it('the copy mail lists every question and answer, escaped', () => {
    const mail = buildCopyMail({ title: 'T', submittedAt: new Date('2026-01-02T03:04:00Z'), rows: [{ question: 'Name <x>', answer: 'Ann & Co' }, { question: 'Empty', answer: '' }] });
    expect(mail.text).toContain('Name <x>\n  Ann & Co');
    expect(mail.text).toContain('Empty\n  -');
    expect(mail.html).toContain('Name &lt;x&gt;');
    expect(mail.html).toContain('Ann &amp; Co');
  });
});
