import { type Block, type Inline, parseBlocks } from '@/lib/markdown';

/**
 * A post's Markdown as the post editor's document, and back (the owner,
 * 2026-11-19: "a rich text reply box", kept as Markdown underneath).
 *
 * The editor (routes/chat/rich-editor.tsx, TipTap) holds a tree of
 * paragraphs, headings, lists, quotes and photographs with bold, italic and
 * link marks: exactly what lib/markdown.ts draws, and nothing it cannot. What
 * is saved is still the Markdown the iPhone app and every other screen read,
 * so a post written either way, and a member's raw Markdown, read the same.
 *
 * Loading goes through `parseBlocks`, the same reading the post is drawn
 * from. Writing back is this file's own, and writes the toolbar's Markdown
 * ("## ", "- ", "**", "*", "> "), with a backslash before a mark that was
 * typed as a character. So text written another way — "# Title", "• item",
 * "_italic_" — is written back the toolbar's way: `roundTrips` says whether
 * a post comes back exactly, which an edit that may only add to its words
 * (20261029260000) needs.
 */

/** The editor's JSON, as much of it as this needs. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: DocNode[] | undefined;
  text?: string | undefined;
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined;
}

interface Marks {
  bold: boolean;
  italic: boolean;
  link: string | null;
}
const NO_MARKS: Marks = { bold: false, italic: false, link: null };

/* ------------------------------------------------------------ Markdown → document */

export function markdownToDoc(text: string): DocNode {
  const content = blocksToNodes(parseBlocks(text));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function blocksToNodes(blocks: Block[]): DocNode[] {
  return blocks.map((block): DocNode => {
    switch (block.kind) {
      case 'paragraph':
        return textblock(
          'paragraph',
          block.lines.flatMap((line, i) => [
            ...(i > 0 ? [{ type: 'hardBreak' }] : []),
            ...inlineNodes(line, NO_MARKS),
          ]),
        );
      case 'heading':
        return {
          ...textblock('heading', inlineNodes(block.content, NO_MARKS)),
          attrs: { level: 2 },
        };
      case 'list':
        return {
          type: block.ordered ? 'orderedList' : 'bulletList',
          ...(block.ordered ? { attrs: { start: block.start } } : {}),
          content: block.items.map((item) => ({
            type: 'listItem',
            content: [textblock('paragraph', inlineNodes(item, NO_MARKS))],
          })),
        };
      case 'quote': {
        const inner = blocksToNodes(block.blocks);
        return { type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] };
      }
      default:
        return { type: 'image', attrs: { path: block.path } };
    }
  });
}

function textblock(type: string, content: DocNode[]): DocNode {
  return content.length ? { type, content } : { type };
}

function inlineNodes(pieces: Inline[], marks: Marks): DocNode[] {
  return pieces.flatMap((piece): DocNode[] => {
    switch (piece.kind) {
      case 'text':
        return piece.text ? [{ type: 'text', text: piece.text, ...markList(marks) }] : [];
      case 'bold':
        return inlineNodes(piece.children, { ...marks, bold: true });
      case 'italic':
        return inlineNodes(piece.children, { ...marks, italic: true });
      default:
        return inlineNodes(piece.children, { ...marks, link: piece.href });
    }
  });
}

function markList(marks: Marks): Pick<DocNode, 'marks'> {
  const list: NonNullable<DocNode['marks']> = [];
  if (marks.link) list.push({ type: 'link', attrs: { href: marks.link } });
  if (marks.bold) list.push({ type: 'bold' });
  if (marks.italic) list.push({ type: 'italic' });
  return list.length ? { marks: list } : {};
}

/* ------------------------------------------------------------ document → Markdown */

export function docToMarkdown(doc: DocNode): string {
  return blocksMarkdown(doc.content ?? []);
}

function blocksMarkdown(nodes: DocNode[]): string {
  return nodes
    .map(blockMarkdown)
    .filter((block) => block.trim() !== '')
    .join('\n\n');
}

function blockMarkdown(node: DocNode): string {
  switch (node.type) {
    case 'paragraph':
      return textblockMarkdown(node.content ?? [], true);
    case 'heading': {
      const words = textblockMarkdown(node.content ?? [], false);
      return words.trim() ? `## ${words.trim()}` : '';
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
      return listItems(node)
        .map((words, i) => `${ordered ? `${start + i}.` : '-'} ${words}`)
        .join('\n');
    }
    case 'blockquote': {
      // A photograph is never quoted: it goes after the quote.
      const children = node.content ?? [];
      const inner = blocksMarkdown(children.filter((child) => child.type !== 'image'));
      const quoted = inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
      return [quoted, ...children.filter((child) => child.type === 'image').map(blockMarkdown)]
        .filter((block) => block.trim() !== '')
        .join('\n\n');
    }
    case 'image': {
      const path = node.attrs?.path;
      return typeof path === 'string' && path ? `![Photo](${path})` : '';
    }
    default:
      // Nothing else is in the editor's schema; its words, if it has any.
      return node.content ? blocksMarkdown(node.content) : '';
  }
}

/** A list's items, one line each: a nested list's items follow at the same level. */
function listItems(list: DocNode): string[] {
  return (list.content ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((child) => {
      if (child.type === 'bulletList' || child.type === 'orderedList') return listItems(child);
      const words = textblockMarkdown(child.content ?? [], false).trim();
      return words ? [words] : [];
    }),
  );
}

type Segment = { text: string; marks: Marks } | { text: '\n'; marks: null };

/**
 * One paragraph's (or heading's, or item's) inline Markdown. `breaks` keeps
 * line breaks; elsewhere they are spaces, as a heading or an item is one line.
 */
function textblockMarkdown(nodes: DocNode[], breaks: boolean): string {
  const segments: Segment[] = nodes.flatMap((node): Segment[] => {
    if (node.type === 'hardBreak') {
      return breaks ? [{ text: '\n', marks: null }] : [{ text: ' ', marks: NO_MARKS }];
    }
    if (node.type !== 'text' || !node.text) return [];
    const marks: Marks = { ...NO_MARKS };
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') marks.bold = true;
      if (mark.type === 'italic') marks.italic = true;
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string')
        marks.link = mark.attrs.href;
    }
    return [{ text: node.text, marks }];
  });

  // The words as typed, to judge each character by what is around it.
  const whole = segments.map((s) => s.text).join('');
  const hasLink = segments.some((s) => s.marks?.link);

  // Spaces at the edge of a mark go outside it: "** word**" is not bold.
  const pieces: Segment[] = [];
  let offset = 0;
  const starts: number[] = [];
  segments.forEach((segment, i) => {
    if (segment.marks === null) {
      pieces.push(segment);
      starts.push(offset);
      offset += 1;
      return;
    }
    const before = segments[i - 1]?.marks ?? NO_MARKS;
    const after = segments[i + 1]?.marks ?? NO_MARKS;
    const lead = /^\s*/.exec(segment.text)?.[0] ?? '';
    const core = segment.text.slice(lead.length).trimEnd();
    const trail = segment.text.slice(lead.length + core.length);
    if (!core) {
      pieces.push({ text: segment.text, marks: common(before, after) });
      starts.push(offset);
    } else {
      if (lead) {
        pieces.push({ text: lead, marks: common(before, segment.marks) });
        starts.push(offset);
      }
      pieces.push({ text: core, marks: segment.marks });
      starts.push(offset + lead.length);
      if (trail) {
        pieces.push({ text: trail, marks: common(segment.marks, after) });
        starts.push(offset + lead.length + core.length);
      }
    }
    offset += segment.text.length;
  });

  let out = '';
  let open: Marks = NO_MARKS;
  // Where the open italic's mark is: "***" is read as bold first, so italic
  // beside bold is written with "_" instead.
  let italicAt = -1;
  const close = (to: Marks) => {
    // Inner first: italic, bold, then the link around them.
    const linkChanges = open.link !== to.link;
    const boldChanges = linkChanges || open.bold !== to.bold;
    const italicChanges = boldChanges || open.italic !== to.italic;
    if (italicChanges && open.italic) {
      if (boldChanges && open.bold && out[italicAt] === '*') {
        out = `${out.slice(0, italicAt)}_${out.slice(italicAt + 1)}`;
      }
      out += out[italicAt] ?? '*';
    }
    if (boldChanges && open.bold) out += '**';
    if (linkChanges && open.link) out += `](${hrefMarkdown(open.link)})`;
    if (linkChanges && to.link) out += '[';
    if (boldChanges && to.bold) out += '**';
    if (italicChanges && to.italic) {
      italicAt = out.length;
      out += out.endsWith('*') ? '_' : '*';
    }
    open = to;
  };
  pieces.forEach((piece, i) => {
    const start = starts[i] ?? 0;
    if (piece.marks === null) {
      close(NO_MARKS);
      out += '\n';
      return;
    }
    close(piece.marks);
    out += escapeText(piece.text, whole, start, hasLink, open.link !== null);
  });
  close(NO_MARKS);

  return out
    .split('\n')
    .map((line) => escapeLineStart(line.trimEnd()))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function common(a: Marks, b: Marks): Marks {
  return {
    bold: a.bold && b.bold,
    italic: a.italic && b.italic,
    link: a.link !== null && a.link === b.link ? a.link : null,
  };
}

function hrefMarkdown(href: string): string {
  return href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>•]/;

/**
 * A backslash before each character that would otherwise be read as a mark,
 * and only those, so ordinary words come back exactly as they went in.
 */
function escapeText(
  text: string,
  whole: string,
  start: number,
  hasLink: boolean,
  inLink: boolean,
): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    const at = start + i;
    const prev = whole[at - 1];
    const next = whole[at + 1];
    const spaceBefore = prev === undefined || /\s/.test(prev);
    const spaceAfter = next === undefined || /\s/.test(next);
    const wordBefore = prev !== undefined && /\w/.test(prev);
    const wordAfter = next !== undefined && /\w/.test(next);
    if (ch === '\\') {
      out += next !== undefined && ESCAPABLE.test(next) ? '\\\\' : '\\';
    } else if (ch === '*') {
      out += spaceBefore && spaceAfter ? '*' : '\\*';
    } else if (ch === '_') {
      out += (wordBefore && wordAfter) || (spaceBefore && spaceAfter) ? '_' : '\\_';
    } else if (ch === '[') {
      out += hasLink || whole.slice(at).includes(']') ? '\\[' : '[';
    } else if (ch === ']' && inLink) {
      // A link's words cannot hold "]"; the nearest that can.
      out += ')';
    } else {
      out += ch;
    }
  }
  return out;
}

/** A line that would start a heading, a list, a quote or a photograph, kept as words. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([-*•])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(#{1,3}\s)/, '$1\\$2')
    .replace(/^(\s*\d{1,3})([.)]\s)/, '$1\\$2')
    .replace(/^(\s*)>/, '$1\\>')
    .replace(/^(\s*)!(\[[^\]\n]*\]\([^)\s]+\)\s*)$/, '$1\\!$2');
}

/**
 * Whether the editor writes this text back exactly. Not, and the editor
 * would change words nobody touched; an edit that may only add to them
 * opens as Markdown instead.
 */
export function roundTrips(text: string): boolean {
  return docToMarkdown(markdownToDoc(text)) === text.trim();
}
