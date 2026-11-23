/**
 * Pasting words with links into a plain box (the owner, 2026-11-23: "when I
 * paste text with links it does not keep the links"). A plain box takes only
 * the clipboard's plain text, which has the words of a link and not where it
 * goes. When what was copied has links, this writes it as Markdown instead,
 * each link as `[words](address)`, which a post draws as a link
 * (lib/markdown.ts). Paragraphs, line breaks and list items stay as lines; the
 * rest of the formatting is left behind, as it is in the plain text.
 */

/** The clipboard's words with their links as Markdown, or null when it has no link. */
export function linkedPaste(data: DataTransfer | null): string | null {
  const html = data?.getData('text/html');
  return html ? markdownFromHtml(html) : null;
}

/** Set apart by a blank line, as paragraphs are. */
const PARAGRAPH = /^(P|H[1-6]|BLOCKQUOTE|UL|OL|TABLE|PRE|SECTION|ARTICLE|HEADER|FOOTER)$/;
/** On a line of their own. */
const LINE = /^(DIV|LI|TR|DT|DD)$/;
const SKIP = /^(SCRIPT|STYLE|META|TITLE|HEAD|TEMPLATE)$/;
/** Addresses a post may link to; anything else is kept as its words. */
const LINKABLE = /^(https?:|mailto:)/i;

export function markdownFromHtml(html: string): string | null {
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
        out += `[${words.replace(/[[\]\\]/g, '\\$&')}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
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

/** Puts `words` in place of the box's selection, as typing would: the box's own change follows. */
export function pasteInto(box: HTMLTextAreaElement, words: string) {
  box.setRangeText(words, box.selectionStart, box.selectionEnd, 'end');
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
