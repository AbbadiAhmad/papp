import { describe, expect, it } from '@jest/globals';
import { validateQuestionConfig } from '../../backend/question-rules';
import { isSafeLink, isVideoLinkValid, parseRichText, resolveColor, toPlainText, wrapSelection } from '../../backend/rich-text';

describe('parseRichText', () => {
  it('parses bold, italic, links, colours, maths and line breaks', () => {
    expect(parseRichText('a **b** *c*')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'bold', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'c' }] },
    ]);
    expect(parseRichText('[site](https://example.com/x?y=1)')).toEqual([{ t: 'link', href: 'https://example.com/x?y=1', c: [{ t: 'text', v: 'site' }] }]);
    expect(parseRichText('{red|stop} {#00f|blue}')).toEqual([
      { t: 'color', color: '#c62828', c: [{ t: 'text', v: 'stop' }] },
      { t: 'text', v: ' ' },
      { t: 'color', color: '#00f', c: [{ t: 'text', v: 'blue' }] },
    ]);
    expect(parseRichText('$x^2$')).toEqual([{ t: 'math', v: 'x^2' }]);
    expect(parseRichText('a\nb')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });

  it('nests formatting', () => {
    expect(parseRichText('**a *b* {green|c}**')).toEqual([
      {
        t: 'bold',
        c: [
          { t: 'text', v: 'a ' },
          { t: 'italic', c: [{ t: 'text', v: 'b' }] },
          { t: 'text', v: ' ' },
          { t: 'color', color: '#2e7d32', c: [{ t: 'text', v: 'c' }] },
        ],
      },
    ]);
  });

  it('shows unclosed or unknown markup literally instead of failing', () => {
    expect(parseRichText('**not closed')).toEqual([{ t: 'text', v: '**not closed' }]);
    expect(parseRichText('5 * 3 = 15')).toEqual([{ t: 'text', v: '5 * 3 = 15' }]);
    expect(parseRichText('{pink|x}')).toEqual([{ t: 'text', v: '{pink|x}' }]);
    expect(parseRichText('[label](not a link)')).toEqual([{ t: 'text', v: '[label](not a link)' }]);
    expect(parseRichText('cost $5')).toEqual([{ t: 'text', v: 'cost $5' }]);
  });

  it('a backslash shows the next character literally', () => {
    expect(parseRichText('\\*not italic\\*')).toEqual([{ t: 'text', v: '*not italic*' }]);
    expect(parseRichText('\\$5 and \\$6')).toEqual([{ t: 'text', v: '$5 and $6' }]);
  });

  it('never produces HTML, scripts or unsafe links: those stay as plain text', () => {
    expect(parseRichText('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
    expect(parseRichText('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }]);
    expect(parseRichText('[x](data:text/html;base64,AAAA)')).toEqual([{ t: 'text', v: '[x](data:text/html;base64,AAAA)' }]);
    expect(parseRichText('{red;background:url(x)|a}')).toEqual([{ t: 'text', v: '{red;background:url(x)|a}' }]);
  });

  it('stays fast on hostile input (bounded work)', () => {
    const started = Date.now();
    parseRichText('**'.repeat(1900));
    parseRichText('[*'.repeat(1900));
    parseRichText('{red|'.repeat(700));
    parseRichText(`${'$'.repeat(1900)}`);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('helpers', () => {
  it('toPlainText drops formatting but keeps the words, links and formulas', () => {
    expect(toPlainText('**Hi** {red|there}, see [docs](https://a.io) for $x^2$\nBye')).toBe('Hi there, see docs (https://a.io) for x^2\nBye');
    expect(toPlainText(null)).toBe('');
  });
  it('accepts only http(s)/mailto links and known colours', () => {
    expect(isSafeLink('https://a.io')).toBe(true);
    expect(isSafeLink('mailto:a@b.io')).toBe(true);
    expect(isSafeLink('ftp://a.io')).toBe(false);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(resolveColor('RED')).toBe('#c62828');
    expect(resolveColor('#12345')).toBeNull();
    expect(resolveColor('expression(1)')).toBeNull();
  });
  it('wrapSelection wraps the selection or inserts a placeholder', () => {
    expect(wrapSelection('hello world', 6, 11, '**', '**', 'x')).toEqual({ value: 'hello **world**', selectionStart: 8, selectionEnd: 13 });
    expect(wrapSelection('hi', 2, 2, '*', '*', 'italic')).toEqual({ value: 'hi*italic*', selectionStart: 3, selectionEnd: 9 });
  });
});

describe('video link', () => {
  it('only http(s) addresses are valid', () => {
    expect(isVideoLinkValid('https://youtu.be/abc')).toBe(true);
    expect(isVideoLinkValid('javascript:alert(1)')).toBe(false);
    expect(isVideoLinkValid('not a url')).toBe(false);
    expect(isVideoLinkValid(5)).toBe(false);
  });
  it('is checked by the question rules on any question type', () => {
    expect(validateQuestionConfig('short_text', { videoUrl: 'https://youtu.be/abc' })).toBeNull();
    expect(validateQuestionConfig('single_choice', { videoUrl: 'https://vimeo.com/1' }, ['a'])).toBeNull();
    expect(validateQuestionConfig('short_text', { videoUrl: 'javascript:alert(1)' })?.code).toBe('bad_video_url');
    expect(validateQuestionConfig('short_text', { videoUrl: 'ftp://x.io/v' })?.code).toBe('bad_video_url');
    expect(validateQuestionConfig('short_text', { videoUrl: '' })).toBeNull();
  });
});
