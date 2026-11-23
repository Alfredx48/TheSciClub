/**
 * What another app shared to the club (Android's share menu; manifest
 * `share_target`, 2026-10-10).
 *
 * The share arrives as a POST the page cannot read, so the service worker
 * keeps it in a cache of its own and opens /share, which reads it once and
 * empties the cache. Shared with src/sw.ts so both name the cache alike.
 */
export const SHARE_CACHE = 'club-share';
export const SHARE_META = '/__share/meta';
export const shareFileKey = (index: number) => `/__share/file-${index}`;
/** Photographs on one post, as a post allows (MAX_ATTACHMENTS). */
export const SHARE_MAX_FILES = 50;

export interface SharedMeta {
  title: string;
  text: string;
  url: string;
  files: number;
}

export interface Shared {
  title: string;
  text: string;
  url: string;
  files: File[];
}

/** Reads what was shared, once: the cache is emptied as it is read. */
export async function takeShared(): Promise<Shared | null> {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(SHARE_CACHE);
  const metaResponse = await cache.match(SHARE_META);
  if (!metaResponse) return null;
  const meta = (await metaResponse.json()) as SharedMeta;
  const files: File[] = [];
  for (let index = 0; index < meta.files; index++) {
    const response = await cache.match(shareFileKey(index));
    if (!response) continue;
    const blob = await response.blob();
    const name = decodeURIComponent(response.headers.get('x-file-name') ?? `shared-${index}`);
    // The worker stored the type as the response's Content-Type.
    const type = response.headers.get('Content-Type') ?? blob.type;
    files.push(new File([blob], name, { type }));
  }
  await caches.delete(SHARE_CACHE);
  return { title: meta.title, text: meta.text, url: meta.url, files };
}

/**
 * The line the topic is listed under: the shared title, or the first line of
 * the words, or the link's address; 140 characters, the title's limit.
 */
export function sharedTitle(shared: Pick<Shared, 'title' | 'text' | 'url'>): string {
  const firstLine = shared.text.split('\n').find((line) => line.trim() !== '') ?? '';
  const candidate = shared.title.trim() || firstLine.trim() || shared.url.trim();
  return candidate.slice(0, 140);
}

/** The first post: the words and the link, without repeating either. */
export function sharedBody(shared: Pick<Shared, 'text' | 'url'>): string {
  const text = shared.text.trim();
  const url = shared.url.trim();
  if (url && !text.includes(url)) return text ? `${text}\n${url}` : url;
  return text;
}
