import { findLinks } from '@/lib/links';
import { type MentionOrganization, splitMentions } from '@/lib/mentions';

/**
 * A small Markdown, for an event's "About it" (the owner, 2026-10-10) and a
 * post's words.
 *
 * The toolbars write it — bold, italic, a heading, bulleted and numbered
 * lists, a link, and in a post a quote and a photograph in place (the owner,
 * 2026-11-19) — and somebody who already knows Markdown can type it. Nothing
 * else is recognised: no tables, no raw HTML, no code blocks. A converter for
 * exactly the toolbar is a page of code; a library for all of Markdown is a
 * dependency and a much larger surface to sanitize.
 *
 * It is read once, into blocks (`parseBlocks`), which this file draws as HTML
 * and the post editor (lib/markdown-doc.ts) loads as its own document, so the
 * two cannot disagree about what a line means.
 *
 * The HTML is for `EventDescription` and `PostBody`, which pass it through the
 * same allowlist a scraped description gets (`sanitizeHtml` in
 * src/routes/events/rich-text.tsx). So this escapes every character of text it
 * emits, and the sanitizer is still the thing that makes it safe: an href this
 * writes is checked there by `safeHref` like any other.
 *
 * A photograph is a line of its own, `![Photo](rooms/<room>/<file>.jpg)`,
 * naming one of the post's own attachments. It is not drawn here: PostBody
 * splits the words at it (`splitPhotos`) and draws the photograph itself, as
 * only it can sign the address. A backslash keeps a mark as typed: `\*` is a
 * star, not italic.
 *
 * Text written before this existed — plain lines, blank lines between
 * paragraphs, bare web addresses — reads as it did: paragraphs, line breaks,
 * and addresses as links, as LinkedText drew them.
 */

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;
/** A photograph, alone on its line. */
const PHOTO = /^\s*!\[[^\]\n]*\]\(([^)\s]+)\)\s*$/;

/** Inline pieces: words, or a mark around more pieces. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold' | 'italic'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  /** Lines joined by line breaks. */
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'photo'; path: string };

/** The text's blocks, as every reader of it sees them. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list = null as { ordered: boolean; start: number; items: string[] } | null;
  let quote: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  const closeList = () => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items.map(parseInline),
      });
    }
    list = null;
  };
  const closeQuote = () => {
    if (quote) blocks.push({ kind: 'quote', blocks: parseBlocks(quote.join('\n')) });
    quote = null;
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
    closeQuote();
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const quoted = QUOTE.exec(line);
    if (quoted) {
      closeParagraph();
      closeList();
      quote ??= [];
      quote.push(quoted[1] ?? '');
      continue;
    }
    closeQuote();
    if (!line.trim()) {
      closeAll();
      continue;
    }
    const photo = PHOTO.exec(line);
    if (photo?.[1]) {
      closeAll();
      blocks.push({ kind: 'photo', path: photo[1] });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[2]) {
      closeAll();
      blocks.push({ kind: 'heading', content: parseInline(heading[2]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[2];
    if (item) {
      const ordered = !bullet;
      closeParagraph();
      if (list && list.ordered !== ordered) closeList();
      list ??= { ordered, start: Number(numbered?.[1] ?? 1), items: [] };
      list.items.push(item);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  closeAll();
  return blocks;
}

/**
 * A backslash before a mark (\* \_ \[ \# …), bold (**…**), italic (*…* or
 * _…_) and links ([words](address)). Markers must hug their words, so
 * "2 * 3 * 4" and snake_case_words stay as typed.
 */
const INLINE =
  /\\([\\`*_{}[\]()#+\-.!>•])|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])|(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let words = '';
  const flush = () => {
    if (words) out.push({ kind: 'text', text: words });
    words = '';
  };
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    words += text.slice(at, match.index);
    const [whole, escaped, linkText, href, bold, starItalic, underscoreItalic] = match;
    if (escaped !== undefined) {
      words += escaped;
    } else if (linkText !== undefined && href !== undefined) {
      flush();
      out.push({ kind: 'link', href, children: parseInline(linkText) });
    } else if (bold !== undefined) {
      flush();
      out.push({ kind: 'bold', children: parseInline(bold) });
    } else {
      flush();
      out.push({ kind: 'italic', children: parseInline(starItalic ?? underscoreItalic ?? '') });
    }
    at = match.index + whole.length;
  }
  words += text.slice(at);
  flush();
  return out;
}

/** Where an @username links to, or null to leave it as words (a post's mentions). */
export type MentionHref = (username: string) => string | null;

/** Organizations an @Full Name links to, as /events/organizations/:id (the owner, 2026-11-17). */
let organizationsNow: readonly MentionOrganization[] = [];

export function markdownToHtml(
  text: string,
  mention?: MentionHref,
  organizations: readonly MentionOrganization[] = [],
): string {
  organizationsNow = organizations;
  return blocksToHtml(parseBlocks(text), mention);
}

function blocksToHtml(blocks: Block[], mention?: MentionHref): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'paragraph':
          return `<p>${block.lines.map((line) => inlineHtml(line, mention)).join('<br>')}</p>`;
        case 'heading':
          return `<h3>${inlineHtml(block.content, mention)}</h3>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          return `<${tag}>${block.items.map((i) => `<li>${inlineHtml(i, mention)}</li>`).join('')}</${tag}>`;
        }
        case 'quote':
          return `<blockquote>${blocksToHtml(block.blocks, mention)}</blockquote>`;
        default:
          // A photograph: drawn by PostBody, which splits the text at it first.
          return '';
      }
    })
    .join('');
}

function inlineHtml(pieces: Inline[], mention?: MentionHref, inLink = false): string {
  return pieces
    .map((piece) => {
      switch (piece.kind) {
        case 'text':
          // A link's own words are only words: no address or @name inside it.
          return inLink ? escapeHtml(piece.text) : plain(piece.text, mention);
        case 'bold':
          return `<strong>${inlineHtml(piece.children, mention, inLink)}</strong>`;
        case 'italic':
          return `<em>${inlineHtml(piece.children, mention, inLink)}</em>`;
        default:
          return `<a href="${escapeHtml(piece.href)}">${inlineHtml(piece.children, mention, true)}</a>`;
      }
    })
    .join('');
}

/** Text with its bare web addresses as links, and its @names where `mention` says. */
function plain(text: string, mention?: MentionHref): string {
  return findLinks(text)
    .map((piece) =>
      piece.kind === 'text'
        ? mentions(piece.text, mention)
        : `<a href="${escapeHtml(piece.href)}">${escapeHtml(piece.label)}</a>`,
    )
    .join('');
}

function mentions(text: string, mention?: MentionHref): string {
  if (!mention) return escapeHtml(text);
  return splitMentions(text, organizationsNow)
    .map((piece) => {
      const href =
        piece.kind === 'mention'
          ? mention(piece.username)
          : piece.kind === 'organization'
            ? `/events/organizations/${piece.id}`
            : null;
      return href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(piece.text)}</a>`
        : escapeHtml(piece.text);
    })
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A post's words in order, split at its photographs, for PostBody to draw
 * each photograph where it was put. Words between photographs keep their
 * Markdown. A photograph inside a quote stays words of the quote.
 */
export type PostPiece = { kind: 'words'; text: string } | { kind: 'photo'; path: string };

export function splitPhotos(text: string): PostPiece[] {
  const pieces: PostPiece[] = [];
  let words: string[] = [];
  const flush = () => {
    const joined = words.join('\n');
    if (joined.trim()) pieces.push({ kind: 'words', text: joined });
    words = [];
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const photo = PHOTO.exec(line);
    if (photo?.[1]) {
      flush();
      pieces.push({ kind: 'photo', path: photo[1] });
    } else {
      words.push(line);
    }
  }
  flush();
  return pieces;
}

/** The photographs a post's words put in place, in order. */
export function photoPaths(text: string): string[] {
  return splitPhotos(text).flatMap((piece) => (piece.kind === 'photo' ? [piece.path] : []));
}

/**
 * The same text with its Markdown marks taken out, for the places that show
 * a few lines of a post rather than the post: a Home card's opening or first
 * reply, a notification's excerpt. Bold and italic become their words, a
 * heading its line, a list item its text, a quote its words, a link its
 * words; a photograph's line goes, as the card shows the photograph. Line
 * breaks stay, for the clamped previews that keep them.
 */
export function markdownToPlain(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => !PHOTO.test(line))
      .map((line) =>
        line
          .replace(/^(\s*)>\s?/, '$1')
          .replace(/^(\s*)#{1,3}\s+/, '$1')
          .replace(/^(\s*)[-*•]\s+/, '$1')
          .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
          .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
          .replace(/(?<![\w*\\])\*(?=\S)(.+?)(?<=[^\s\\])\*(?![\w*])/g, '$1')
          .replace(/(?<![\w_\\])_(?=\S)(.+?)(?<=[^\s\\])_(?![\w_])/g, '$1')
          .replace(/\\([\\`*_{}[\]()#+\-.!>•])/g, '$1'),
      )
      .join('\n')
      // A photograph's line gone leaves one gap, not two.
      .replace(/\n{3,}/g, '\n\n')
  );
}
