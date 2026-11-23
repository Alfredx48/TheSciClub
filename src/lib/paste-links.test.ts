import { describe, expect, it } from 'vitest';
import { markdownFromHtml } from '@/lib/paste-links';

describe('pasting words with links into a plain box', () => {
  it('keeps each link as Markdown, and the paragraphs and list items as lines', () => {
    const copied =
      '<meta charset="utf-8"><p>See <a href="https://example.org/ramps">the [ramp] guide</a> and' +
      ' <a href="https://example.org/a (b)">this</a>.</p><ul><li>One</li><li><a href="mailto:a@example.org">Write</a></li></ul>' +
      '<p>Not <a href="javascript:alert(1)">this one</a>.</p>';
    expect(markdownFromHtml(copied)).toBe(
      'See [the \\[ramp\\] guide](https://example.org/ramps) and [this](https://example.org/a%20%28b%29).\n\n' +
        '- One\n- [Write](mailto:a@example.org)\n\nNot this one.',
    );
  });

  it('leaves words with no link to the browser', () => {
    expect(markdownFromHtml('<p>Just <b>words</b></p>')).toBeNull();
    expect(markdownFromHtml('<p><a href="javascript:x">no</a></p>')).toBeNull();
  });

  it('writes a message’s links as words and address, which every copy of the app shows', () => {
    expect(
      markdownFromHtml(
        '<p>See <a href="https://example.org/ramps">the ramp guide</a> or <a href="https://www.example.org/">example.org</a></p>',
        'plain',
      ),
    ).toBe('See the ramp guide (https://example.org/ramps) or https://www.example.org/');
  });
});
