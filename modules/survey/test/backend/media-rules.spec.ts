import { describe, expect, it } from '@jest/globals';
import { collectMediaIds, detectImageMime, extensionForMime, MAX_IMAGE_BYTES, validateImageUpload } from '../../backend/media-rules';
import { parseImageRef, validateQuestionConfig } from '../../backend/question-rules';
import { normalizeSettings } from '../../backend/survey-settings';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const ID = '5b2f1d0e-1111-4222-8333-444455556666';
const ID2 = '6c3a2e1f-1111-4222-8333-444455556666';

describe('image type detection (from the file bytes only)', () => {
  it('recognises PNG, JPEG and WebP', () => {
    expect(detectImageMime(PNG)).toBe('image/png');
    expect(detectImageMime(JPEG)).toBe('image/jpeg');
    expect(detectImageMime(WEBP)).toBe('image/webp');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
  });

  it('rejects SVG, HTML, GIF, scripts and truncated files whatever they claim to be', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(detectImageMime(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageMime(enc('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectImageMime(enc('GIF89a....'))).toBeNull();
    expect(detectImageMime(PNG.slice(0, 4))).toBeNull();
    expect(detectImageMime(new Uint8Array())).toBeNull();
  });

  it('validateImageUpload enforces presence, size and type', () => {
    expect(validateImageUpload(PNG)).toEqual({ mime: 'image/png' });
    expect(validateImageUpload(undefined)).toHaveProperty('error');
    expect(validateImageUpload(new Uint8Array())).toHaveProperty('error');
    const tooBig = new Uint8Array(MAX_IMAGE_BYTES + 1);
    tooBig.set(PNG);
    expect(validateImageUpload(tooBig)).toHaveProperty('error');
    expect(validateImageUpload(new TextEncoder().encode('not an image'))).toHaveProperty('error');
  });
});

describe('image references', () => {
  it('needs a real id and a description', () => {
    expect(parseImageRef(undefined)).toEqual({ ref: null });
    expect(parseImageRef(null)).toEqual({ ref: null });
    expect(parseImageRef({ mediaId: ID, alt: '  A library  ' })).toEqual({ ref: { mediaId: ID, alt: 'A library' } });
    expect(parseImageRef({ mediaId: ID, alt: '' })).toHaveProperty('error');
    expect(parseImageRef({ mediaId: ID, alt: '   ' })).toHaveProperty('error');
    expect(parseImageRef({ mediaId: 'not-a-uuid', alt: 'x' })).toHaveProperty('error');
    expect(parseImageRef({ mediaId: '../../etc/passwd', alt: 'x' })).toHaveProperty('error');
    expect(parseImageRef({ mediaId: ID, alt: 'x'.repeat(201) })).toHaveProperty('error');
    expect(parseImageRef('x')).toHaveProperty('error');
  });

  it('a question picture is checked by the question rules', () => {
    expect(validateQuestionConfig('short_text', { image: { mediaId: ID, alt: 'Shelf' } })).toBeNull();
    expect(validateQuestionConfig('short_text', { image: { mediaId: ID, alt: '' } })?.code).toBe('bad_image');
  });

  it('the survey header picture is kept by the settings and bad ones are dropped', () => {
    expect(normalizeSettings({ headerImage: { mediaId: ID, alt: 'Logo' } }).headerImage).toEqual({ mediaId: ID, alt: 'Logo' });
    expect(normalizeSettings({ headerImage: { mediaId: ID, alt: '' } }).headerImage).toBeUndefined();
    expect(normalizeSettings({ headerImage: 'x' }).headerImage).toBeUndefined();
  });

  it('collects every referenced id once', () => {
    const ids = collectMediaIds({
      headerImage: { mediaId: ID, alt: 'a' },
      sections: [
        { image: { mediaId: ID2, alt: 'b' }, questions: [{ config: { image: { mediaId: ID, alt: 'c' } } }, { config: {} }, { config: null }] },
        { questions: [] },
      ],
    });
    expect(ids.sort()).toEqual([ID, ID2].sort());
  });
});
