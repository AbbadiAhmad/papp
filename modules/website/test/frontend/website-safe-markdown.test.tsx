import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlockRenderer } from '../../frontend/pages/BlockRenderer';
import { SafeMarkdown } from '../../frontend/pages/SafeMarkdown';
import type { WebsiteBlock } from '../../frontend/api';

/**
 * Guards the module's safe-by-construction rendering claim (see
 * modules/website/DECISIONS.md WEBSITE-D2/D3): a `<script>` typed into a
 * `text`/`columns` block's Markdown must never become a real executing DOM
 * node — it must render as inert text, via `react-markdown` with no
 * `rehype-raw` plugin, never `dangerouslySetInnerHTML`.
 */
describe('website module: Markdown blocks never execute embedded HTML', () => {
  const scriptPayload = 'Hello <script>window.__websiteXssProbe = true;</script> world';

  it('SafeMarkdown renders a script-tag payload as inert text, not a live <script> element', () => {
    const { container } = render(<SafeMarkdown markdown={scriptPayload} />);

    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __websiteXssProbe?: boolean }).__websiteXssProbe).toBeUndefined();
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('world');
  });

  it('BlockRenderer renders a "text" block\'s Markdown through the same safe path', () => {
    const block: WebsiteBlock = { id: 'b1', pageId: 'p1', orderIndex: 0, type: 'text', config: { markdown: scriptPayload } };
    const { container } = render(<BlockRenderer block={block} />);

    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __websiteXssProbe?: boolean }).__websiteXssProbe).toBeUndefined();
  });

  it('BlockRenderer renders a "columns" block\'s Markdown (both sides) through the same safe path', () => {
    const block: WebsiteBlock = {
      id: 'b2',
      pageId: 'p1',
      orderIndex: 0,
      type: 'columns',
      config: {
        left: { heading: 'Left', text: scriptPayload },
        right: { heading: 'Right', text: 'plain right text' },
      },
    };
    const { container } = render(<BlockRenderer block={block} />);

    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __websiteXssProbe?: boolean }).__websiteXssProbe).toBeUndefined();
  });
});
