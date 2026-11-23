/**
 * Pasting words with links into a plain box (the owner, 2026-11-23: "when I
 * paste text with links it does not keep the links"). A plain box takes only
 * the clipboard's plain text, which has the words of a link and not where it
 * goes. When what was copied has links, this writes it as Markdown instead,
 * each link as `[words](address)`, which a post draws as a link
 * (lib/markdown.ts). Paragraphs, line breaks and list items stay as lines; the
 * rest of the formatting is left behind, as it is in the plain text.
 */

/**
 * A message is drawn as plain words, its bare addresses as links (LinkedText), and the iPhone
 * app carries its own copy of that, so a message's link is written `words (address)`
 * (the owner, 2026-11-23): read the same on every copy of the app and in a notification.
 */
export type LinkStyle = 'markdown' | 'plain';

/** The clipboard's words with their links kept, or null when it has no link. */
export function linkedPaste(
  data: DataTransfer | null,
  style: LinkStyle = 'markdown',
): string | null {
  const html = data?.getData('text/html');
  return html ? markdownFromHtml(html, style) : null;
}

/** Set apart by a blank line, as paragraphs are. */
const PARAGRAPH = /^(P|H[1-6]|BLOCKQUOTE|UL|OL|TABLE|PRE|SECTION|ARTICLE|HEADER|FOOTER)$/;
/** On a line of their own. */
const LINE = /^(DIV|LI|TR|DT|DD)$/;
const SKIP = /^(SCRIPT|STYLE|META|TITLE|HEAD|TEMPLATE)$/;
/** Addresses a post may link to; anything else is kept as its words. */
const LINKABLE = /^(https?:|mailto:)/i;

export function markdownFromHtml(html: string, style: LinkStyle = 'markdown'): string | null {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const hasLink = [...body.querySelectorAll('a[href]')].some((a) =>
    LINKABLE.test(a.getAttribute('href')?.trim() ?? ''),
  );
  if (!hasLink) return null;

  let out = '';
  // Ends what is written so far with `count` line breaks, unless it already does.
  const breakLines = (count: number) => {
    out = out.replace(/[ \t]+$/, '');
    if (!out) return;
    const has = /\n*$/.exec(out)?.[0].length ?? 0;
    if (has < count) out += '\n'.repeat(count - has);
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (!(node instanceof Element) || SKIP.test(node.tagName)) return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href')?.trim() ?? '';
      const words = node.textContent.replace(/\s+/g, ' ').trim();
      if (LINKABLE.test(href) && words) {
        const address = href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
        if (style === 'plain') {
          // An address as its own words is written once.
          out += sameAddress(words, href) ? address : `${words} (${address})`;
        } else {
          out += `[${words.replace(/[[\]\\]/g, '\\$&')}](${address})`;
        }
        return;
      }
    }
    const gap = PARAGRAPH.test(node.tagName) ? 2 : LINE.test(node.tagName) ? 1 : 0;
    if (gap) breakLines(gap);
    if (node.tagName === 'LI') out += '- ';
    for (const child of node.childNodes) walk(child);
    if (gap) breakLines(gap);
  };
  walk(body);

  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "example.org/a" and "https://www.example.org/a/" are the same address. */
function sameAddress(words: string, href: string): boolean {
  const bare = (address: string) =>
    address
      .toLowerCase()
      .replace(/^(https?:\/\/|mailto:)/, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  return bare(words) === bare(href);
}

/** Puts `words` in place of the box's selection, as typing would: the box's own change follows. */
export function pasteInto(box: HTMLTextAreaElement, words: string) {
  box.setRangeText(words, box.selectionStart, box.selectionEnd, 'end');
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
