/**
 * Safe inline formatting for survey text (survey ext. E). Framework-free and import-free so the
 * respondent page, the builder and the server (plain-text emails) share one parser (explicit `.ts`
 * import from the browser, SURVEY-D8 — this file must therefore never import a sibling).
 *
 * The text is NOT HTML. Owners type a tiny markup and the page turns it into React elements, so no
 * author can inject markup, scripts or styles:
 *
 *   **bold**   *italic*   [label](https://link)   {red|coloured text}   {#b00020|hex colour}
 *   $x^2 + y^2 = z^2$ (maths, rendered with KaTeX)   \* \[ \{ \$ \\ (a backslash shows the next character literally)
 *   a new line is kept as a line break
 *
 * Only http(s) and mailto links are kept; colours are a fixed set of names or #rgb/#rrggbb.
 */

export const MAX_RICH_TEXT_LENGTH = 4000;
const MAX_MATH_LENGTH = 300;
const MAX_DEPTH = 5;
const ATTEMPT_BUDGET = 2000;

export const COLOR_NAMES: Record<string, string> = {
  red: '#c62828',
  blue: '#1565c0',
  green: '#2e7d32',
  orange: '#e65100',
  purple: '#6a1b9a',
  gray: '#616161',
};

export type RichNode =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'bold' | 'italic'; c: RichNode[] }
  | { t: 'link'; href: string; c: RichNode[] }
  | { t: 'color'; color: string; c: RichNode[] }
  | { t: 'math'; v: string };

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SAFE_LINK = /^(?:https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i;

/** The CSS colour for a colour word from the markup, or null when it is not allowed. */
export function resolveColor(word: string): string | null {
  if (HEX.test(word)) return word;
  return COLOR_NAMES[word.toLowerCase()] ?? null;
}

export function isSafeLink(url: string): boolean {
  return url.length <= 2048 && SAFE_LINK.test(url);
}

interface Result {
  nodes: RichNode[];
  end: number;
  closed: boolean;
}

export function parseRichText(input: string | null | undefined): RichNode[] {
  const source = (input ?? '').slice(0, MAX_RICH_TEXT_LENGTH);
  let budget = ATTEMPT_BUDGET;

  const push = (nodes: RichNode[], text: string) => {
    if (!text) return;
    const last = nodes[nodes.length - 1];
    if (last && last.t === 'text') last.v += text;
    else nodes.push({ t: 'text', v: text });
  };

  const parse = (start: number, closer: string | null, depth: number): Result => {
    const nodes: RichNode[] = [];
    let i = start;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\' && i + 1 < source.length) {
        push(nodes, source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '\n') {
        nodes.push({ t: 'br' });
        i += 1;
        continue;
      }
      if (closer === '**' && source.startsWith('**', i)) return { nodes, end: i + 2, closed: true };
      if (closer === '*' && ch === '*' && !source.startsWith('**', i)) return { nodes, end: i + 1, closed: true };
      if ((closer === ']' && ch === ']') || (closer === '}' && ch === '}')) return { nodes, end: i + 1, closed: true };

      const canNest = depth < MAX_DEPTH && budget > 0;
      if (source.startsWith('**', i) && canNest) {
        budget -= 1;
        const inner = parse(i + 2, '**', depth + 1);
        if (inner.closed) {
          nodes.push({ t: 'bold', c: inner.nodes });
          i = inner.end;
          continue;
        }
      } else if (ch === '*' && canNest) {
        budget -= 1;
        const inner = parse(i + 1, '*', depth + 1);
        if (inner.closed) {
          nodes.push({ t: 'italic', c: inner.nodes });
          i = inner.end;
          continue;
        }
      } else if (ch === '[' && canNest) {
        budget -= 1;
        const label = parse(i + 1, ']', depth + 1);
        if (label.closed && source[label.end] === '(') {
          const close = source.indexOf(')', label.end + 1);
          const href = close > 0 ? source.slice(label.end + 1, close).trim() : '';
          if (close > 0 && isSafeLink(href)) {
            nodes.push({ t: 'link', href, c: label.nodes });
            i = close + 1;
            continue;
          }
        }
      } else if (ch === '{' && canNest) {
        const open = /^\{([#A-Za-z0-9]{2,20})\|/.exec(source.slice(i, i + 24));
        const color = open ? resolveColor(open[1]) : null;
        if (open && color) {
          budget -= 1;
          const inner = parse(i + open[0].length, '}', depth + 1);
          if (inner.closed) {
            nodes.push({ t: 'color', color, c: inner.nodes });
            i = inner.end;
            continue;
          }
        }
      } else if (ch === '$') {
        let j = i + 1;
        while (j < source.length && source[j] !== '$' && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
        const formula = source.slice(i + 1, j);
        if (source[j] === '$' && formula.trim() && formula.length <= MAX_MATH_LENGTH) {
          nodes.push({ t: 'math', v: formula });
          i = j + 1;
          continue;
        }
      }
      push(nodes, ch === '*' && source.startsWith('**', i) ? '**' : ch);
      i += ch === '*' && source.startsWith('**', i) ? 2 : 1;
    }
    return { nodes, end: i, closed: closer === null };
  };

  return parse(0, null, 0).nodes;
}

/** The text without any formatting (maths shown as its source), for emails, exports and screen-reader labels. */
export function toPlainText(input: string | null | undefined): string {
  const walk = (nodes: RichNode[]): string =>
    nodes
      .map((n) => {
        if (n.t === 'text') return n.v;
        if (n.t === 'br') return '\n';
        if (n.t === 'math') return n.v;
        if (n.t === 'link') return `${walk(n.c)} (${n.href})`;
        return walk(n.c);
      })
      .join('');
  return walk(parseRichText(input));
}

/**
 * Wraps the selected text (or inserts a placeholder) with markup, for the builder toolbar. Returns the new
 * value and where the selection should be afterwards.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(start, end) || placeholder;
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  return { value: next, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length };
}

/** A video link in a question: only http(s), no embedding, shown as a plain link. */
export function isVideoLinkValid(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
