import { describe, expect, it } from '@jest/globals';
import { applyPlaceholders, renderMarkdownToSafeHtml } from '../../../src/core/notifications/markdown.util';

describe('renderMarkdownToSafeHtml', () => {
  it('strips <script> tags AND their contents from admin-authored bodies', () => {
    const html = renderMarkdownToSafeHtml('Hello <script>alert("xss")</script> world');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });

  it('renders **bold** markdown to <strong>', () => {
    const html = renderMarkdownToSafeHtml('this is **bold** text');

    expect(html).toContain('<strong>bold</strong>');
  });

  it('strips event-handler attributes (onclick) while keeping the allowed tag', () => {
    const html = renderMarkdownToSafeHtml('<p onclick="steal()">click me</p>');

    expect(html).not.toContain('onclick');
    expect(html).not.toContain('steal()');
    expect(html).toContain('<p>click me</p>');
  });

  it('keeps http/https/mailto links (the allowlisted schemes) with href and title only', () => {
    const html = renderMarkdownToSafeHtml('[docs](https://example.com "Docs") and [mail](mailto:a@b.co)');

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('title="Docs"');
    expect(html).toContain('href="mailto:a@b.co"');
  });

  it('drops a javascript: href — scheme not in the allowlist', () => {
    const html = renderMarkdownToSafeHtml('<a href="javascript:alert(1)">x</a>');

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('alert(1)');
  });

  it('drops tags outside the email-friendly allowlist (iframe, img) but keeps allowed structure', () => {
    const html = renderMarkdownToSafeHtml('<iframe src="https://evil.example"></iframe>\n\n- item one\n- item two');

    expect(html).not.toContain('<iframe');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
  });

  it('passes Arabic text through intact (RTL content is data, not markup)', () => {
    const html = renderMarkdownToSafeHtml('مرحباً **بك** في المنصة');

    expect(html).toContain('مرحباً');
    expect(html).toContain('<strong>بك</strong>');
    expect(html).toContain('في المنصة');
  });
});

describe('applyPlaceholders', () => {
  it('substitutes every {{name}} occurrence', () => {
    expect(applyPlaceholders('Hi {{name}}, your account ({{name}}) is ready', { name: 'Aisha' })).toBe(
      'Hi Aisha, your account (Aisha) is ready',
    );
  });

  it('tolerates whitespace inside the braces ({{ name }})', () => {
    expect(applyPlaceholders('Hi {{ name }}!', { name: 'Omar' })).toBe('Hi Omar!');
  });

  it('substitutes an empty display name as an empty string (missing-value behavior)', () => {
    expect(applyPlaceholders('Hi {{name}}!', { name: '' })).toBe('Hi !');
  });

  it('leaves unknown placeholders untouched — {{name}} is the only Phase 4 placeholder', () => {
    expect(applyPlaceholders('Hi {{name}}, code {{code}}', { name: 'Aisha' })).toBe('Hi Aisha, code {{code}}');
  });

  it('substitutes into Arabic text without disturbing it', () => {
    expect(applyPlaceholders('مرحباً {{name}}، تم تحديث حسابك', { name: 'ليلى' })).toBe('مرحباً ليلى، تم تحديث حسابك');
  });
});
