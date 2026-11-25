/**
 * link-preview's pure half: which link, whether it may be fetched, and what a
 * page says about itself. No network here, so all of it is tested
 * (extract.test.ts) and index.ts is only the fetching and the writing.
 */

/* ------------------------------------------------------------ which link */

// The same rules as src/lib/links.ts, which decides what the reader sees as a
// link: a preview must never be for an address the message does not show as
// one. Copied rather than imported because an Edge Function is deployed from
// its own folder; extract.test.ts holds the two together.
const CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING = /[.,;:!?'"’”)\]}>]$/;

function trimEnd(candidate: string): string {
  let value = candidate;
  while (TRAILING.test(value)) {
    const last = value.slice(-1);
    if (last === ')') {
      const opened = (value.match(/\(/g) ?? []).length;
      const closed = (value.match(/\)/g) ?? []).length;
      if (closed <= opened) break;
    }
    value = value.slice(0, -1);
  }
  return value;
}

function hrefFor(candidate: string): string | null {
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;
  return url.href;
}

/** The first link in what a member wrote, or null. One preview per message. */
export function firstLink(body: string): string | null {
  for (const match of body.matchAll(CANDIDATE)) {
    const href = hrefFor(trimEnd(match[0]));
    if (href) return href;
  }
  return null;
}

/* --------------------------------------------------------------- YouTube */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video's id for a YouTube address in any of its shapes, or null. */
export function youtubeId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const [, kind, value] = url.pathname.split('/');
      if (kind && ['shorts', 'embed', 'live', 'v'].includes(kind)) id = value ?? null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Videos one card holds at most: the first link's and three more. */
export const MAX_VIDEOS = 4;

/**
 * The YouTube videos in what a member wrote, in order, each once, at most
 * MAX_VIDEOS. Several play side by side like photographs (the owner, 2026-11-25).
 */
export function youtubeLinks(body: string): { href: string; id: string }[] {
  const found: { href: string; id: string }[] = [];
  for (const match of body.matchAll(CANDIDATE)) {
    const href = hrefFor(trimEnd(match[0]));
    const id = href ? youtubeId(href) : null;
    if (!href || !id || found.some((video) => video.id === id)) continue;
    found.push({ href, id });
    if (found.length === MAX_VIDEOS) break;
  }
  return found;
}

/* ------------------------------------------------- where it may be fetched */

/**
 * Whether the club's server may fetch this address on a member's behalf.
 *
 * The address is whatever a member typed, so this is the line between "read
 * a public web page" and "make the server reach into somewhere it can see
 * and the member cannot" — the database's own network, a cloud metadata
 * address, a router. Web addresses with a dotted name on the usual ports
 * only, and never an address written as a private, loopback or link-local
 * number. Every redirect is put through this again (index.ts).
 */
export function mayFetch(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // An IPv6 literal is never a page somebody shares; refusing all of them
  // saves telling the private ones apart.
  if (host.startsWith('[')) return false;
  if (!host.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|arpa|test|invalid)$/.test(host)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  // A number written any other way ("2130706433", "0x7f.1") is how a filter
  // like this one is usually walked past; no real page is addressed so.
  if (/^[\d.x]+$/i.test(host) && !v4) return false;
  return true;
}

/**
 * Whether an address a host name resolved to is on the public internet.
 *
 * mayFetch reads only how the address is written, and a public-looking name
 * can resolve to anything: 169.254.169.254.nip.io, or a domain whose owner
 * points it at 10.0.0.1 (security scan 2026-10-17, F5). So index.ts looks the
 * name up and asks this of every answer before each fetch. IPv4 outside the
 * reserved blocks; IPv6 only in global unicast (2000::/3), less documentation,
 * 6to4 and Teredo, which carry an IPv4 address of their own.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if ([a, b, c, Number(v4[4])].some((n) => n > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // shared (CGNAT)
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, documentation
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // documentation
    if (a === 203 && b === 0 && c === 113) return false; // documentation
    return true;
  }
  const v6 = ip.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(v6) || !v6.includes(':')) return false;
  // An empty piece is where '::' stands for zeros.
  const pieces = v6.split(':');
  const hextet = (i: number) => {
    const piece = pieces[i];
    return piece === undefined || piece === '' ? 0 : Number.parseInt(piece, 16);
  };
  const head = hextet(0);
  if (!(head >= 0x2000 && head <= 0x3fff)) return false;
  const second = hextet(1);
  if (head === 0x2001 && second === 0x0db8) return false; // documentation
  if (head === 0x2001 && second === 0) return false; // Teredo
  if (head === 0x2002) return false; // 6to4
  return true;
}

/**
 * Whether every address `host` resolves to is public. False when it resolves
 * to nothing, or the lookup fails: nothing is fetched that was not vetted.
 * `resolve` is Deno.resolveDns in index.ts and a stand-in in the tests.
 *
 * fetch looks the name up again for itself, so a name whose answer changes
 * between the two lookups (DNS rebinding) is not covered by this; the
 * link-fetch Worker (LINK_FETCH_URL) is, as it fetches from Cloudflare.
 */
export async function resolvesPublicly(
  host: string,
  resolve: (host: string, type: 'A' | 'AAAA') => Promise<string[]>,
): Promise<boolean> {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return isPublicAddress(name);
  const answers = (
    await Promise.all(
      (['A', 'AAAA'] as const).map((type) => resolve(name, type).catch(() => [] as string[])),
    )
  ).flat();
  return answers.length > 0 && answers.every(isPublicAddress);
}

/* -------------------------------------------------- what a page says */

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Absolute http(s) address of the page's picture. */
  image: string | null;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

/** Entities decoded, whitespace collapsed, cut to `max` with an ellipsis. */
function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// The lookbehind keeps a name from starting inside another word: without it,
// a long run of letters with no '=' after it was tried from every one of its
// letters, which is quadratic in the run (security scan 2026-10-17, F12).
const ATTRIBUTE = /(?<![-\w:.])([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * Each `<name …>` tag in the page, in order, found by one forward scan. A
 * regex such as /<meta\b[^>]*>/ rescans to the end of the page from every
 * opening that is never closed, which a hostile page can make quadratic.
 * `lower` is the page lower-cased once by the caller.
 */
function* tagsNamed(
  html: string,
  lower: string,
  name: string,
): Generator<{ tag: string; end: number }> {
  const open = `<${name}`;
  let at = 0;
  for (;;) {
    const start = lower.indexOf(open, at);
    if (start < 0) return;
    // As \b: the name ends here, so <meta> and <meta …> but not <metadata>.
    const next = lower[start + open.length];
    if (next !== undefined && /\w/.test(next)) {
      at = start + open.length;
      continue;
    }
    const end = lower.indexOf('>', start);
    // Nothing after this is closed either.
    if (end < 0) return;
    yield { tag: html.slice(start, end + 1), end: end + 1 };
    at = end + 1;
  }
}

/** The text of the first <title>, found as tagsNamed finds tags. */
function titleText(html: string, lower: string): string | undefined {
  const first = tagsNamed(html, lower, 'title').next();
  if (first.done) return undefined;
  const to = lower.indexOf('</title>', first.value.end);
  return to < 0 ? undefined : html.slice(first.value.end, to);
}

/**
 * Amazon's product pages supply no picture in preview tags. Their main
 * product image has a named element instead; taking that one avoids turning
 * a logo or a recommended product into the picture under somebody's link.
 * Only on Amazon's own pages, after redirects have been checked by index.ts.
 */
function amazonPicture(html: string, lower: string, pageUrl: string): string | undefined {
  if (!/(^|\.)amazon\.com$/i.test(new URL(pageUrl).hostname)) return undefined;
  for (const { tag } of tagsNamed(html, lower, 'img')) {
    const attributes = new Map(
      [...tag.matchAll(ATTRIBUTE)].map((attribute) => [
        (attribute[1] ?? '').toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
      ]),
    );
    if (!['landingImage', 'imgBlkFront'].includes(attributes.get('id') ?? '')) continue;
    const large = attributes.get('data-old-hires')?.trim();
    if (large) return large;
    return attributes.get('src')?.trim();
  }
  return undefined;
}

/**
 * The page's own description of itself: Open Graph first, then Twitter's
 * tags, then the plain <title> and description. Attributes in either order
 * and either quote, because pages write them every way (Instagram puts
 * `property` first, plenty put `content` first).
 */
export function readMeta(html: string, pageUrl: string): PageMeta {
  const lower = html.toLowerCase();
  const tags = new Map<string, string>();
  for (const { tag } of tagsNamed(html, lower, 'meta')) {
    let key: string | null = null;
    let content: string | null = null;
    for (const attribute of tag.matchAll(ATTRIBUTE)) {
      const name = (attribute[1] ?? '').toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      if (name === 'property' || name === 'name' || name === 'itemprop')
        key ??= value.toLowerCase();
      else if (name === 'content') content = value;
    }
    // The first of each wins: a page that repeats og:image lists its best first.
    if (key && content !== null && !tags.has(key)) tags.set(key, content);
  }
  const titleTag = titleText(html, lower);
  const pick = (...keys: string[]) => keys.map((k) => tags.get(k)).find((v) => v?.trim());

  const rawImage =
    pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') ??
    amazonPicture(html, lower, pageUrl);
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), pageUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') image = resolved.href;
    } catch {
      image = null;
    }
  }

  return {
    title: clean(pick('og:title', 'twitter:title') ?? titleTag, 200),
    description: clean(pick('og:description', 'twitter:description', 'description'), 300),
    siteName: clean(pick('og:site_name', 'application-name'), 80),
    image,
  };
}

/* ----------------------------------------------------------- pictures */

/** The picture types the bucket takes, by what the server said it sent. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The site's own name for the card's small line: "reeve.org". */
export function hostLabel(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return href;
  }
}
