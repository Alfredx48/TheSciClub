import { describe, expect, it } from 'vitest';
import { findLinks } from '../../../src/lib/links.ts';
import {
  decodeEntities,
  firstLink,
  isPublicAddress,
  mayFetch,
  readMeta,
  resolvesPublicly,
  youtubeId,
  youtubeLinks,
} from './extract.ts';

describe('firstLink', () => {
  it.each([
    'A cushion: https://www.amazon.com/ROHO/dp/B00?ref=x. Worth it.',
    'see www.reeve.org/resources today',
    '(see https://example.com)',
    'https://en.wikipedia.org/wiki/Spinal_cord_(anatomy) is long',
    'two: https://one.example/a and https://two.example/b',
    'nothing here, e.g. T6.Complete',
    'javascript:alert(1) and http://localhost',
  ])('agrees with what the app draws as a link: %s', (body) => {
    const drawn = findLinks(body).flatMap((piece) => (piece.kind === 'link' ? [piece.href] : []));
    expect(firstLink(body)).toBe(drawn[0] ?? null);
  });
});

describe('youtubeId', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
  ])('finds the video in %s', (href) => {
    expect(youtubeId(href)).toBe('dQw4w9WgXcQ');
  });

  it.each([
    'https://www.youtube.com/@RickAstleyYT',
    'https://www.youtube.com/watch?v=short',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL123',
  ])('is not fooled by %s', (href) => {
    expect(youtubeId(href)).toBeNull();
  });

  it('lists each video in the words once, in order, four at most', () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
    const body = `https://youtube.com/shorts/${ids[0]} and https://reeve.org then https://youtu.be/${ids[1]} again https://www.youtube.com/watch?v=${ids[0]} ${ids
      .slice(2)
      .map((id) => `https://youtu.be/${id}`)
      .join(' ')}`;
    expect(youtubeLinks(body).map((video) => video.id)).toEqual(ids.slice(0, 4));
  });
});

describe('mayFetch', () => {
  it.each([
    'https://www.reeve.org/',
    'http://example.com/page',
    'https://www.instagram.com/p/abc/',
    'https://93.184.216.34/',
  ])('fetches a public page: %s', (href) => {
    expect(mayFetch(href)).toBe(true);
  });

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/admin',
    'http://172.20.1.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://db.internal/',
    'http://printer.local/',
    'https://example.com:5432/',
    'https://user:pass@example.com/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://intranet/',
  ])('refuses %s', (href) => {
    expect(mayFetch(href)).toBe(false);
  });
});

describe('readMeta', () => {
  it('prefers Open Graph, resolves the picture, and decodes entities', () => {
    const html = `<html><head><title>Plain title</title>
      <meta property="og:title" content="The Christopher &amp; Dana Reeve Foundation">
      <meta content="Curing spinal cord injury &#8212; and living well." property="og:description" />
      <meta property='og:site_name' content='Reeve'>
      <meta property="og:image" content="/img/share.jpg">
      </head></html>`;
    expect(readMeta(html, 'https://www.reeve.org/about')).toEqual({
      title: 'The Christopher & Dana Reeve Foundation',
      description: 'Curing spinal cord injury — and living well.',
      siteName: 'Reeve',
      image: 'https://www.reeve.org/img/share.jpg',
    });
  });

  it('falls back to Twitter tags, then the plain title and description', () => {
    const html = `<title>  A  page
      title </title><meta name="description" content="Plain words">
      <meta name="twitter:image" content="https://cdn.example/x.png">`;
    expect(readMeta(html, 'https://example.com/')).toEqual({
      title: 'A page title',
      description: 'Plain words',
      siteName: null,
      image: 'https://cdn.example/x.png',
    });
  });

  it('reads Amazon’s main product picture when there are no preview tags', () => {
    const html = `<title>A commode</title>
      <img id="logo" src="/logo.png">
      <img data-old-hires="https://m.media-amazon.com/images/I/product.jpg"
        id="landingImage" src="/small.jpg">`;
    expect(readMeta(html, 'https://www.amazon.com/dp/example').image).toBe(
      'https://m.media-amazon.com/images/I/product.jpg',
    );
  });

  it('uses the product picture’s src when Amazon has no larger one', () => {
    const html = "<img id='imgBlkFront' data-old-hires='' src='/product.jpg'>";
    expect(readMeta(html, 'https://www.amazon.com/dp/example').image).toBe(
      'https://www.amazon.com/product.jpg',
    );
  });

  it('keeps preview tags ahead of the product picture', () => {
    const html = `<meta property="og:image" content="/share.jpg">
      <img id="landingImage" src="/product.jpg">`;
    expect(readMeta(html, 'https://www.amazon.com/dp/example').image).toBe(
      'https://www.amazon.com/share.jpg',
    );
  });

  it('takes no arbitrary image or another site’s imitation of Amazon’s markup', () => {
    expect(readMeta('<img id="logo" src="/logo.jpg">', 'https://www.amazon.com/').image).toBeNull();
    expect(
      readMeta('<img id="landingImage" src="/product.jpg">', 'https://notamazon.com/').image,
    ).toBeNull();
  });

  it('refuses a product picture a browser would run', () => {
    const html = '<img id="landingImage" src="javascript:alert(1)">';
    expect(readMeta(html, 'https://www.amazon.com/').image).toBeNull();
  });

  it('takes no picture a browser would run', () => {
    const html = '<meta property="og:image" content="javascript:alert(1)">';
    expect(readMeta(html, 'https://example.com/').image).toBeNull();
  });

  it('cuts a long title with an ellipsis', () => {
    const html = `<meta property="og:title" content="${'word '.repeat(80)}">`;
    const title = readMeta(html, 'https://example.com/').title ?? '';
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('…')).toBe(true);
  });

  it('reads what Instagram actually sends', () => {
    const html =
      '<meta property="og:title" content="National Geographic (&#064;natgeo) &#x2022; Instagram photos and videos" />';
    expect(readMeta(html, 'https://www.instagram.com/natgeo/').title).toBe(
      'National Geographic (@natgeo) • Instagram photos and videos',
    );
  });
});

describe('decodeEntities', () => {
  it('leaves what it does not know alone', () => {
    expect(decodeEntities('a &madeup; b &#0; c')).toBe('a &madeup; b &#0; c');
  });
});

// Security scan 2026-10-17, F5: mayFetch reads only how an address is written,
// and a public-looking name can resolve to the server's own network.
describe('isPublicAddress', () => {
  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::6810:84e5',
    '2a00:1450:4009:81f::200e',
  ])('lets %s through', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.0.8',
    '198.18.0.1',
    '203.0.113.9',
    '224.0.0.1',
    '256.1.1.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '2001:0:4136:e378::1',
    '2001::1',
    '2002:a00:1::1',
    'ff02::1',
    'not-an-address',
  ])('refuses %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('resolvesPublicly', () => {
  const dns =
    (answers: Record<string, string[]>) =>
    (host: string, type: 'A' | 'AAAA'): Promise<string[]> => {
      const found = answers[`${host} ${type}`];
      return found ? Promise.resolve(found) : Promise.reject(new Error('NotFound'));
    };

  it('lets a name through when every answer is public', async () => {
    const resolve = dns({
      'example.org A': ['93.184.216.34'],
      'example.org AAAA': ['2606:2800::1'],
    });
    expect(await resolvesPublicly('example.org', resolve)).toBe(true);
  });

  it('refuses a public-looking name that resolves to the cloud metadata address', async () => {
    // How it is written passes: this is the gap the lookup closes.
    expect(mayFetch('http://169.254.169.254.nip.io/latest/meta-data/')).toBe(true);
    const resolve = dns({ '169.254.169.254.nip.io A': ['169.254.169.254'] });
    expect(await resolvesPublicly('169.254.169.254.nip.io', resolve)).toBe(false);
  });

  it('refuses a name with one private answer among public ones', async () => {
    const resolve = dns({ 'mixed.example A': ['93.184.216.34', '10.0.0.5'] });
    expect(await resolvesPublicly('mixed.example', resolve)).toBe(false);
  });

  it('refuses a name whose only private answer is IPv6', async () => {
    const resolve = dns({ 'six.example A': ['93.184.216.34'], 'six.example AAAA': ['::1'] });
    expect(await resolvesPublicly('six.example', resolve)).toBe(false);
  });

  it('refuses a name that resolves to nothing', async () => {
    expect(await resolvesPublicly('gone.example', dns({}))).toBe(false);
  });

  it('judges a written-out IPv4 address without asking DNS', async () => {
    expect(await resolvesPublicly('93.184.216.34', dns({}))).toBe(true);
  });
});

// Security scan 2026-10-17, F12: any member can link a page they host, and
// readMeta used to be quadratic in it. Each of these took minutes before.
describe('readMeta on a hostile page', () => {
  const quick = (html: string) => {
    const began = performance.now();
    readMeta(html, 'https://example.org/');
    return performance.now() - began;
  };

  it('reads a meta tag that is one enormous name without an = in linear time', () => {
    expect(quick(`<meta ${'a'.repeat(400_000)}>`)).toBeLessThan(1000);
  });

  it('reads a page of meta tags that are never closed in linear time', () => {
    expect(quick('<meta '.repeat(80_000))).toBeLessThan(1000);
  });

  it('reads a page of titles that are never closed in linear time', () => {
    expect(quick('<title>'.repeat(60_000))).toBeLessThan(1000);
  });

  it('still reads an ordinary page the same way', () => {
    const page =
      '<html><head><title>Plain &amp; simple</title>' +
      '<meta content="A summary" property="og:description">' +
      "<meta property='og:image' content='/pic.jpg'>" +
      '<metadata name="og:title" content="not a meta tag"></head></html>';
    expect(readMeta(page, 'https://example.org/a')).toEqual({
      title: 'Plain & simple',
      description: 'A summary',
      siteName: null,
      image: 'https://example.org/pic.jpg',
    });
  });
});
