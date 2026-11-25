/**
 * link-preview: the picture and title under a link in Chat.
 *
 * The owner, 2026-10-06: a link a member posts should show its page's picture
 * and title, and a YouTube video should play where it is. Called through
 * pg_net by `link_preview_enqueue` when a message or a post with a link is
 * written or edited, with `{ table, id }`. It asks the database for the words
 * (`link_preview_source`), fetches the first link's page once, keeps a copy of
 * its picture in the club's own `link-previews` bucket, and writes the
 * preview onto the row (`link_preview_save`).
 *
 * Fetched here, once, rather than by every reader's phone, at the owner's
 * choice: a member scrolling past a link tells nobody outside the club that
 * they did. A YouTube video contacts YouTube only when somebody presses play.
 *
 * Deployed with `verify_jwt = false`, like push-notify: the caller is the
 * database and carries the vault's `link_preview_secret`, which this function
 * passes on without holding. Anybody can call the public URL and it does
 * nothing for them.
 *
 * What it will fetch is decided by `mayFetch` (extract.ts), on the first
 * address and on every redirect, because the address is whatever a member
 * typed; and by `resolvesPublicly`, on where the name actually resolves.
 * The fetch itself is made by the link-fetch Worker on Cloudflare, so a name
 * that changes its answer cannot reach Supabase. Without LINK_FETCH_URL and
 * LINK_FETCH_SECRET there is no preview: fetching from here would reopen that
 * gap (2026-11-23). Pages are read to 512 KB, pictures to 2 MB, each request to six
 * seconds. Nothing it fails at is an error a member sees: the link stays a
 * link, without a card.
 */

import { sniffImageType } from '../_shared/image-type.ts';
import {
  firstLink,
  hostLabel,
  IMAGE_TYPES,
  MAX_VIDEOS,
  mayFetch,
  type PageMeta,
  readMeta,
  resolvesPublicly,
  youtubeId,
  youtubeLinks,
} from './extract.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  resolveDns(query: string, recordType: 'A' | 'AAAA'): Promise<string[]>;
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKET = 'link-previews';
const PAGE_LIMIT = 512 * 1024;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const TABLES = new Set(['chat_messages', 'chat_posts']);
/** The link-fetch Worker; unset, nothing is fetched. */
const FETCH_URL = Deno.env.get('LINK_FETCH_URL') ?? '';
const FETCH_SECRET = Deno.env.get('LINK_FETCH_SECRET') ?? '';

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { apikey: SERVICE_KEY, ...extra };
  if (!SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
}

/**
 * The same GET, made by the link-fetch Worker on Cloudflare (link-fetch-worker/),
 * where no address inside Supabase can be reached. Closes the DNS rebinding gap
 * that `resolvesPublicly` leaves (extract.ts). Its answer is rebuilt as the
 * site's own: status, type, Location and the bytes.
 */
async function fetchThroughWorker(href: string, accept: string): Promise<Response> {
  const relayed = await fetch(FETCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-fetch-secret': FETCH_SECRET },
    body: JSON.stringify({ url: href, accept }),
    signal: AbortSignal.timeout(TIMEOUT_MS + 2000),
  });
  if (!relayed.ok) {
    await relayed.body?.cancel();
    throw new Error(`link-fetch: HTTP ${relayed.status}`);
  }
  const status = Number(relayed.headers.get('x-upstream-status') ?? '0');
  const headers = new Headers();
  for (const [from, to] of [
    ['x-upstream-type', 'content-type'],
    ['x-upstream-location', 'location'],
    ['x-upstream-length', 'content-length'],
  ] as const) {
    const value = relayed.headers.get(from);
    if (value) headers.set(to, value);
  }
  const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
  if (empty) await relayed.body?.cancel();
  return new Response(empty ? null : relayed.body, { status: status || 502, headers });
}

interface Fetched {
  url: string;
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * GET an address a member supplied, following redirects by hand so that each
 * one is checked, and reading no more than `limit` bytes. Null on anything
 * that is not a plain success.
 */
async function fetchLimited(start: string, limit: number, accept: string): Promise<Fetched | null> {
  if (!FETCH_URL || !FETCH_SECRET) return null;
  let href = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // How the address is written, then where its name really leads.
    const resolve = (host: string, type: 'A' | 'AAAA') => Deno.resolveDns(host, type);
    if (!mayFetch(href) || !(await resolvesPublicly(new URL(href).hostname, resolve))) {
      return null;
    }
    let response: Response;
    try {
      response = await fetchThroughWorker(href, accept);
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      href = new URL(location, href).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > limit) {
      await response.body.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        // A page longer than the limit still has its <head> in what was read.
        if (accept.startsWith('text/html')) break;
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(new ArrayBuffer(chunks.reduce((n, c) => n + c.byteLength, 0)));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const type =
      (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return { url: href, type, bytes };
  }
  return null;
}

/** What a YouTube video is called, from YouTube's own oEmbed. */
async function youtubeMeta(href: string, id: string): Promise<PageMeta> {
  const fallback: PageMeta = {
    title: null,
    description: null,
    siteName: 'YouTube',
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
  const oembed = await fetchLimited(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(href)}`,
    64 * 1024,
    'application/json',
  );
  if (!oembed) return fallback;
  try {
    const data = JSON.parse(new TextDecoder().decode(oembed.bytes)) as {
      title?: unknown;
      author_name?: unknown;
    };
    return {
      ...fallback,
      title: typeof data.title === 'string' ? data.title.slice(0, 200) : null,
      description: typeof data.author_name === 'string' ? data.author_name.slice(0, 300) : null,
    };
  } catch {
    return fallback;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A copy of the picture in the club's bucket; its path there, or null. */
async function keepPicture(imageUrl: string): Promise<string | null> {
  const picture = await fetchLimited(
    imageUrl,
    IMAGE_LIMIT,
    'image/webp,image/jpeg,image/png,image/gif',
  );
  if (!picture) return null;
  // Typed by its bytes, not the server's word: SVG (which can carry script)
  // and anything else that is not a kept image are refused.
  const type = sniffImageType(picture.bytes);
  const extension = type ? IMAGE_TYPES[type] : undefined;
  if (!type || !extension) return null;
  // Named after the picture's address, so a page linked twice is one file.
  const path = `${await sha256Hex(imageUrl)}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': type, 'x-upsert': 'true' }),
    body: picture.bytes,
  });
  if (!upload.ok) {
    console.error('link-preview: could not keep a picture', upload.status, await upload.text());
    return null;
  }
  return path;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });

  const secret = request.headers.get('x-preview-secret') ?? '';
  let table: unknown;
  let id: unknown;
  try {
    ({ table, id } = (await request.json()) as { table?: unknown; id?: unknown });
  } catch {
    return reply(400, { error: 'not JSON' });
  }
  if (
    typeof table !== 'string' ||
    !TABLES.has(table) ||
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return reply(400, { error: 'expected { table, id }' });
  }

  const source = await rpc('link_preview_source', { p_secret: secret, p_table: table, p_id: id });
  if (!source.ok) {
    if (source.status === 401 || source.status === 403)
      return reply(401, { error: 'not the trigger' });
    console.error('link-preview: link_preview_source failed', source.status, await source.text());
    return reply(502, { error: 'could not read the row' });
  }
  const body = (await source.json()) as string | null;
  const link = body ? firstLink(body) : null;
  if (!link) return reply(200, { preview: false });

  const video = youtubeId(link);
  let meta: PageMeta;
  if (video) {
    meta = await youtubeMeta(link, video);
  } else {
    const page = await fetchLimited(link, PAGE_LIMIT, 'text/html,application/xhtml+xml');
    if (!page?.type.includes('html')) return reply(200, { preview: false });
    meta = readMeta(new TextDecoder().decode(page.bytes), page.url);
  }

  const imagePath = meta.image ? await keepPicture(meta.image) : null;
  // A card with nothing on it but the address says less than the link does.
  if (!meta.title && !imagePath) return reply(200, { preview: false });

  // When the first link is a video, the other videos in the words come too,
  // drawn side by side like photographs (the owner, 2026-11-25).
  const videos: {
    url: string;
    title: string | null;
    imagePath: string | null;
    youtubeId: string;
  }[] = [];
  if (video) {
    for (const more of youtubeLinks(body ?? '').filter((v) => v.id !== video)) {
      const moreMeta = await youtubeMeta(more.href, more.id);
      const picture = moreMeta.image ? await keepPicture(moreMeta.image) : null;
      videos.push({
        url: more.href,
        title: moreMeta.title,
        imagePath: picture,
        youtubeId: more.id,
      });
      if (videos.length === MAX_VIDEOS - 1) break;
    }
  }

  const preview = {
    url: link,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName ?? hostLabel(link),
    imagePath,
    youtubeId: video,
    ...(videos.length > 0 ? { videos } : {}),
  };
  const saved = await rpc('link_preview_save', {
    p_secret: secret,
    p_table: table,
    p_id: id,
    // The words this was made from; the database writes nothing if they
    // have been edited since.
    p_body: body,
    p_preview: preview,
  });
  if (!saved.ok) {
    console.error('link-preview: link_preview_save failed', saved.status, await saved.text());
    return reply(502, { error: 'could not save' });
  }
  return reply(200, { preview: true });
});
