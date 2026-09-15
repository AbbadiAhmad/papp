import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Markdown -> sanitized HTML, at send/display time ONLY — the DB stores
 * Markdown source, never pre-rendered HTML (ARCHITECTURE.md §12.1).
 *
 * Templates and notification bodies are ADMIN-authored content (D22), so
 * the render is sanitizing by design: `marked` passes raw inline HTML
 * through untouched, and `sanitize-html` then strips anything not in the
 * allowlist below — a template containing `<script>` comes out with the
 * script gone. The allowlist is deliberately email-friendly basics only
 * (no iframes, no forms, no event attributes, http(s)/mailto links only).
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'blockquote',
    'p', 'br', 'hr', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

export function renderMarkdownToSafeHtml(markdown: string): string {
  // marked.parse is synchronous when no async extensions are registered;
  // `async: false` pins that so the return type stays `string`.
  const rawHtml = marked.parse(markdown, { async: false, gfm: true, breaks: true });
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}

/**
 * The one placeholder the Phase 4 renderer supports: `{{name}}` (the
 * recipient's display name), substituted at render time — for the email
 * channel per recipient at send time, and for the in-app channel when the
 * owner reads their inbox. Whitespace inside the braces is tolerated
 * ({{ name }}). Documented in the seeded default templates (migration 0006).
 */
export function applyPlaceholders(text: string, values: { name: string }): string {
  return text.replace(/\{\{\s*name\s*\}\}/g, values.name);
}
