import { Box } from '@mui/material';
import Markdown from 'react-markdown';

/**
 * The ONLY free-form authoring surface in this module (a `text` block's
 * `markdown` field) — rendered here, and only here, so admin preview and
 * the public site never diverge. `react-markdown` renders straight to real
 * React elements (no `dangerouslySetInnerHTML` anywhere in this component),
 * and — critically — raw HTML embedded in the Markdown source is NOT
 * executed by default (no `rehype-raw` plugin is used): it's dropped/
 * escaped as inert text. This is what keeps a `<script>` typed into a text
 * block from ever running, without needing a separate sanitizer step.
 */
export function SafeMarkdown({ markdown }: { markdown: string }) {
  return (
    <Box sx={{ '& p:first-of-type': { mt: 0 }, '& p:last-of-type': { mb: 0 } }}>
      <Markdown>{markdown}</Markdown>
    </Box>
  );
}
