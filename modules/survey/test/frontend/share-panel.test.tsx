import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import coreEn from '../../../../apps/api/src/core/i18n/locales/en.json';
import surveyEn from '../../locales/en.json';
import { SharePanel, surveyEmbedSnippet, surveyShareUrl } from '../../frontend/components/SharePanel';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', { ...coreEn, ...surveyEn }, true, true);
  await i18n.changeLanguage('en');
});

describe('share helpers', () => {
  it('builds the one public reader URL', () => {
    expect(surveyShareUrl('abc', 'https://library.example')).toBe('https://library.example/survey/abc');
  });

  it('builds an iframe snippet and escapes the title so it cannot break out of the attribute', () => {
    const snippet = surveyEmbedSnippet('https://x.example/survey/1', 'Say "hi" <b>& bye');
    expect(snippet).toContain('src="https://x.example/survey/1"');
    expect(snippet).toContain('title="Say &quot;hi&quot; &lt;b&gt;&amp; bye"');
    expect(snippet.startsWith('<iframe ')).toBe(true);
    expect(snippet.endsWith('</iframe>')).toBe(true);
  });
});

describe('SharePanel', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('shows the link and embed code, draws a QR image, and copies the link', async () => {
    render(<SharePanel open onClose={() => undefined} surveyId="s-1" title="Reader survey" published />);
    const url = `${window.location.origin}/survey/s-1`;
    expect(screen.getByLabelText('Link for readers')).toHaveValue(url);
    expect((screen.getByLabelText('Embed in a web page') as HTMLTextAreaElement).value).toContain(`src="${url}"`);
    const qr = await screen.findByAltText('QR code for the survey "Reader survey"');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole('link', { name: 'Download PNG' })).toHaveAttribute('download', 'survey-s-1.png');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(screen.queryByText(/not published yet/)).toBeNull();
  });

  it('warns that an unpublished survey cannot be opened by readers yet', () => {
    render(<SharePanel open onClose={() => undefined} surveyId="s-2" title="Draft" published={false} />);
    expect(screen.getByText(/not published yet/)).toBeInTheDocument();
  });

  it('copies the embed code', async () => {
    render(<SharePanel open onClose={() => undefined} surveyId="s-3" title="T" published />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy embed code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^<iframe /)));
  });
});
