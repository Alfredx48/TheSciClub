import { describe, expect, it } from 'vitest';
import { markdownToHtml, markdownToPlain, splitPhotos } from '@/lib/markdown';
import { type DocNode, docToMarkdown, markdownToDoc, roundTrips } from '@/lib/markdown-doc';

const text = (words: string, ...marks: string[]): DocNode => ({
  type: 'text',
  text: words,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

// The post editor saves Markdown (the owner, 2026-11-19). What it writes must
// read back as what the member saw, and a post written with the toolbar must
// come back exactly, or an edit that may only add to it is refused.
describe('the post editor and Markdown', () => {
  it('comes back exactly for what the toolbar writes', () => {
    const post = [
      '## What worked',
      'First **bold** and *italic*, a [link](https://norcalsci.org) and @ana.r\nsame paragraph',
      '- One\n- Two',
      '3. Three\n4. Four',
      '> Quoted **words**\n>\n> Second paragraph',
      '![Photo](rooms/r1/a.jpg)',
      'Plain https://example.org/a_b and snake_case and 2 * 3',
    ].join('\n\n');
    expect(roundTrips(post)).toBe(true);
  });

  it('keeps marks typed as characters as characters', () => {
    const typed = doc(
      paragraph(text('Price *5* or _x_ and [1] \\o/')),
      paragraph(text('- not a list')),
      paragraph(text('# not a heading')),
      paragraph(text('1. not numbered')),
      paragraph(text('> not a quote')),
    );
    const saved = docToMarkdown(typed);
    expect(markdownToHtml(saved)).toBe(
      '<p>Price *5* or _x_ and [1] \\o/</p><p>- not a list</p><p># not a heading</p><p>1. not numbered</p><p>&gt; not a quote</p>',
    );
    expect(markdownToPlain(saved).split('\n\n')[0]).toBe('Price *5* or _x_ and [1] \\o/');
    expect(docToMarkdown(markdownToDoc(saved))).toBe(saved);
  });

  it('keeps the spaces at the edge of a mark outside it', () => {
    const saved = docToMarkdown(
      doc(paragraph(text('Say '), text('this ', 'bold'), text('now', 'bold', 'italic'))),
    );
    expect(saved).toBe('Say **this _now_**');
    expect(markdownToHtml(saved)).toBe('<p>Say <strong>this <em>now</em></strong></p>');
  });

  it('puts photographs where they were, apart from the words', () => {
    const saved = docToMarkdown(
      doc(
        paragraph(text('Before')),
        { type: 'image', attrs: { path: 'rooms/r1/a.jpg' } },
        paragraph(text('After')),
      ),
    );
    expect(splitPhotos(saved)).toEqual([
      { kind: 'words', text: 'Before\n' },
      { kind: 'photo', path: 'rooms/r1/a.jpg' },
      { kind: 'words', text: '\nAfter' },
    ]);
    expect(markdownToPlain(saved)).toBe('Before\n\nAfter');
    // Never inside a quote, where it would be neither uploaded nor drawn.
    expect(
      docToMarkdown(
        doc({
          type: 'blockquote',
          content: [{ type: 'image', attrs: { path: 'local:1' } }, paragraph(text('Quoted'))],
        }),
      ),
    ).toBe('> Quoted\n\n![Photo](local:1)');
  });

  it('says when text written another way would not come back as it was', () => {
    expect(roundTrips('# Title\n\n• item')).toBe(false);
    expect(roundTrips('Just words,\nas members always wrote them.')).toBe(true);
  });
});
