import { afterEach, describe, expect, it } from 'vitest';
import { youtubeEmbedUrl } from '@/lib/chat/link-preview';
import * as edge from '../netlify/edge-functions/youtube-embed';
import NETLIFY from '../netlify.toml?raw';
import PAGE from '../public/embed/youtube.html?raw';

/**
 * The store app's YouTube player, public/embed/youtube.html, and the headers
 * its edge function sets. YouTube refuses a frame on capacitor://localhost,
 * so the app frames this page on thesciclub.com instead.
 */

const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(PAGE)?.[1] ?? '';
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(PAGE)?.[1] ?? '';

function header(name: string): string | undefined {
  return edge.EMBED_HEADERS[name];
}

function directive(name: string): string[] {
  const found = (header('Content-Security-Policy') ?? '')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name);
  return found?.slice(1) ?? [];
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/** Runs the page's script as if opened with this URL suffix. */
function open(suffix: string) {
  window.history.replaceState(null, '', `/embed/youtube.html${suffix}`);
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(PAGE)?.[1] ?? '';
  const script = document.createElement('script');
  script.textContent = SCRIPT;
  document.body.append(script);
  return {
    player: document.querySelector('iframe'),
    refused: document.getElementById('refused'),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('the YouTube page', () => {
  it.each(['#v=dQw4w9WgXcQ', '?v=dQw4w9WgXcQ'])(
    'plays a video id with the same address the website uses (%s)',
    (suffix) => {
      const { player, refused } = open(suffix);
      expect(player).toHaveAttribute('src', youtubeEmbedUrl('dQw4w9WgXcQ'));
      expect(player?.getAttribute('src')).toContain('playsinline=1');
      expect(player).toHaveAttribute('title', 'YouTube video');
      expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      expect(player).toHaveAttribute('allowfullscreen');
      expect(refused).not.toBeVisible();
    },
  );

  it('passes nothing but the id on to YouTube', () => {
    const { player } = open('#list=PL123&v=dQw4w9WgXcQ&autoplay=0&start=60');
    expect(player).toHaveAttribute('src', youtubeEmbedUrl('dQw4w9WgXcQ'));
  });

  it.each([
    ['no id', ''],
    ['an empty id', '?v='],
    ['ten characters', '?v=dQw4w9WgXc'],
    ['twelve characters', '?v=dQw4w9WgXcQQ'],
    ['a path', '#v=..%2F..%2Fx%3Fa%3D'],
    ['a stray character', '?v=dQw4w9WgX%3C'],
    ['a trailing newline', '?v=dQw4w9WgXcQ%0A'],
    ['a space', '?v=dQw4w9WgX%20Q'],
  ])('refuses %s with a short message', (_name, query) => {
    const { player, refused } = open(query);
    expect(player).toBeNull();
    expect(refused).toBeVisible();
    expect(refused).toHaveTextContent("This video can't be played here.");
  });

  it('stays dark until the player paints, with the message in white', () => {
    expect(STYLE).toMatch(/html,\s*body \{[^}]*background: #000;/);
    expect(STYLE).toMatch(/iframe \{[^}]*background: #000;/);
    expect(STYLE).toMatch(/p \{[^}]*color: #fff;/);
  });

  it('is not indexed', () => {
    expect(PAGE).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(PAGE).toContain('<html lang="en">');
  });
});

describe("the YouTube page's headers", () => {
  it('are set by an edge function for exactly this page', () => {
    const declared = NETLIFY.split('[[edge_functions]]')
      .slice(1)
      .filter((block) => block.includes('youtube-embed'));
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatch(/^\s*path = "\/embed\/youtube\.html"$/m);
    expect(declared[0]).toMatch(/^\s*function = "youtube-embed"$/m);
    // An inline config would add paths beside netlify.toml's.
    expect('config' in edge).toBe(false);
  });

  it("replace the site-wide headers on the page's response", async () => {
    const siteWide = new Response('<!doctype html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      },
    });
    const response = await edge.default(new Request('https://thesciclub.com/embed/youtube.html'), {
      next: () => Promise.resolve(siteWide),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!doctype html>');
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
    // Exactly the page's value: an appended one would read "a, b".
    for (const [name, value] of Object.entries(edge.EMBED_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value);
    }
  });

  it("allow the page's inline script and style by hash, and nothing else", async () => {
    expect(directive('default-src')).toEqual(["'none'"]);
    expect(directive('script-src')).toEqual([await sha256(SCRIPT)]);
    expect(directive('style-src')).toEqual([await sha256(STYLE)]);
    expect(directive('base-uri')).toEqual(["'none'"]);
    expect(directive('form-action')).toEqual(["'none'"]);
  });

  it("frame only YouTube's privacy-enhanced player", () => {
    expect(directive('frame-src')).toEqual(['https://www.youtube-nocookie.com']);
  });

  it('let only the iPhone app, the Android app and the club frame it', () => {
    expect(directive('frame-ancestors')).toEqual([
      'capacitor:',
      'capacitor://localhost',
      'https://localhost',
      'https://thesciclub.com',
    ]);
    expect(header('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('send the club as the referrer, and keep the page out of search', () => {
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });
});
