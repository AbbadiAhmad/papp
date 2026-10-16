import { Box, Link } from '@mui/material';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Fragment, useMemo } from 'react';
import { parseRichText, type RichNode } from '../../backend/rich-text.ts';

/**
 * Renders survey text written in the safe inline markup (see backend/rich-text.ts): bold, italic, links,
 * colours and KaTeX maths. Nothing is interpreted as HTML — the parser produces a small tree and each node
 * becomes a React element. The only raw HTML is KaTeX's own output for a formula, with `trust` off.
 */

function renderMath(source: string): { html: string } | null {
  try {
    return { html: katex.renderToString(source, { throwOnError: true, output: 'htmlAndMathml', trust: false, maxSize: 20, maxExpand: 200, strict: 'ignore' }) };
  } catch {
    return null;
  }
}

function Nodes({ nodes }: { nodes: RichNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>;
          case 'br':
            return <br key={i} />;
          case 'bold':
            return (
              <strong key={i}>
                <Nodes nodes={n.c} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <Nodes nodes={n.c} />
              </em>
            );
          case 'color':
            return (
              <span key={i} style={{ color: n.color }}>
                <Nodes nodes={n.c} />
              </span>
            );
          case 'link':
            return (
              <Link key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
                <Nodes nodes={n.c} />
              </Link>
            );
          case 'math': {
            const rendered = renderMath(n.v);
            // A formula KaTeX cannot read is shown as typed instead of breaking the page.
            return rendered ? <span key={i} dir="ltr" dangerouslySetInnerHTML={{ __html: rendered.html }} /> : <code key={i}>{n.v}</code>;
          }
        }
      })}
    </>
  );
}

export function RichText({ text, component = 'span' }: { text: string | null | undefined; component?: 'span' | 'div' }) {
  const nodes = useMemo(() => parseRichText(text), [text]);
  return (
    <Box component={component} sx={{ overflowWrap: 'anywhere' }}>
      <Nodes nodes={nodes} />
    </Box>
  );
}
