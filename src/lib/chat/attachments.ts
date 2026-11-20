import { useEffect, useState } from 'react';
import { describeError } from '@/lib/describe-error';
import { preparePhoto, prepareThumb } from '@/lib/image';
import { photoBroke } from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';

/**
 * Photographs on a message or a post.
 *
 * Limits (the owner, 2026-09-21), each held twice so a bypassed client is still held:
 *
 *   four per message     here, and `cardinality(attachments) <= 4` on the row
 *   images only          here (`image/*`), and the bucket's allowed types
 *   10MB before reading  here, before `createImageBitmap` stalls a phone; bucket limit 2MB
 *   1,600px webp         `preparePhoto`: detail matters (a wound, a set-up). JPEG on iPhone,
 *                        which cannot write webp (image.ts); the old fallback broke phone uploads
 *
 * The bucket is private; there must never be a public URL (20260918200000). URLs are signed
 * under the member's token and cached just under their hour.
 *
 * Upload first, then the row; if the row is refused, the files are deleted. A file surviving a
 * failed delete is still behind the read policy: bytes, not disclosure.
 */

export const CHAT_BUCKET: SignedBucket = 'chat';
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_EDGE = 1600;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** A chat photograph's small copy: a tile in a topic or on Home, not the viewer. */
export const CHAT_THUMB_EDGE = 800;

/** Not quite the hour storage signs for, so nothing is drawn on its last second. */
const SIGNED_FOR_SECONDS = 3600;
const CACHE_FOR_MS = 50 * 60 * 1000;

export type AttachmentResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Why these files cannot be attached, in a sentence, or null when they can.
 * Pure, so the composer's test can hold it to each limit.
 */
export function attachmentProblem(files: File[], alreadyAttached: number): string | null {
  if (files.length === 0) return null;
  if (alreadyAttached + files.length > MAX_ATTACHMENTS) {
    return `Up to ${MAX_ATTACHMENTS} photographs on one message.`;
  }
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      return `${file.name || 'That file'} is not a photograph. Photographs only — a video can be linked.`;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      return `${file.name || 'That photograph'} is over 10MB. Try a smaller one.`;
    }
  }
  return null;
}

export function photosFromLibrary(chosen: FileList | null, remaining: number) {
  const selected = Array.from(chosen ?? []);
  const photos = selected.slice(0, remaining);
  return {
    photos,
    overflow: selected.length > photos.length ? 'Only the photos that fit were added.' : null,
  };
}

/** `threads/<thread_id>` or `rooms/<room_id>` — the folder the read policy checks. */
export function attachmentFolder(kind: 'thread' | 'room', id: string): string {
  return kind === 'thread' ? `threads/${id}` : `rooms/${id}`;
}

/** describeError handles the bucket's own errors; "refused" means not in the thread or room. */
const UPLOAD_REFUSAL = {
  attempt: 'The photograph did not upload.',
  refused: 'You cannot add a photograph here.',
};

/**
 * Shrink and upload each file, in order. All or nothing: a failure part-way
 * removes what has already gone up and reports the failure.
 */
export async function uploadAttachments(
  files: File[],
  folder: string,
  /** The longest side to keep. A group's picture is only ever a small tile. */
  maxEdge: number = MAX_ATTACHMENT_EDGE,
): Promise<AttachmentResult<string[]>> {
  const storage = getSupabase().storage.from(CHAT_BUCKET);
  const uploaded: string[] = [];
  for (const file of files) {
    const { blob, ext } = await preparePhoto(file, maxEdge);
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    // The small copy beside it, best effort: a tile draws the photograph without one.
    const thumb = await prepareThumb(blob, CHAT_THUMB_EDGE);
    const [{ error }] = await Promise.all([
      storage.upload(path, blob, { contentType: blob.type, upsert: false }),
      thumb
        ? storage
            .upload(thumbPath(path), thumb, { contentType: thumb.type, upsert: false })
            .catch(() => null)
        : null,
    ]);
    if (error) {
      // The refused one's copy may have gone up beside it.
      await deleteAttachments([...uploaded, path]);
      return { ok: false, error: describeError(error, UPLOAD_REFUSAL) };
    }
    uploaded.push(path);
  }
  return { ok: true, value: uploaded };
}

/** Best effort, and silent: the caller has already said what mattered. */
export async function deleteAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await getSupabase()
      .storage.from(CHAT_BUCKET)
      .remove([...paths, ...paths.map(thumbPath)]);
  } catch {
    // Nothing to tell anybody. The file is still behind the read policy.
  }
}

/**
 * The buckets read through signed URLs, one cache for all. `photos` (faces, seeds, logos) from
 * HANDOFF.md "What Home is" step 6, part 2, via `usePhotoUrls` in src/lib/photos.ts.
 */
export type SignedBucket = 'chat' | 'photos' | 'link-previews';

/** Keyed by bucket and path: the same path in two buckets is two files. */
const signed = new Map<string, { url: string; until: number }>();
const cacheKey = (bucket: SignedBucket, path: string) => `${bucket}\n${path}`;

/**
 * The photos bucket's URLs outlive a reload; chat's do not.
 *
 * A re-signed URL is a new URL, so the browser downloaded every face again (Peers reload 1,060ms
 * vs 580ms; HANDOFF.md, "Home, step 6"). Only `photos`, readable by every member anyway; a chat
 * URL opens a private photo, so it stays in memory. Both cleared on sign-out (account.tsx).
 */
const KEPT_BUCKET: SignedBucket = 'photos';
const KEPT_KEY = 'thesciclub.signed-photos';

function restoreKept(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEPT_KEY);
  } catch {
    // Private mode, or storage blocked: faces are signed again, as before.
  }
  if (!stored) return;
  try {
    const now = Date.now();
    const kept = JSON.parse(stored) as Record<string, { url?: unknown; until?: unknown }>;
    for (const [path, hit] of Object.entries(kept)) {
      if (typeof hit.url === 'string' && typeof hit.until === 'number' && hit.until > now) {
        signed.set(cacheKey(KEPT_BUCKET, path), { url: hit.url, until: hit.until });
      }
    }
  } catch {
    // Not ours, or damaged. Nothing restored; the next signing writes it again.
  }
}

function saveKept(): void {
  const now = Date.now();
  const prefix = cacheKey(KEPT_BUCKET, '');
  const kept: Record<string, { url: string; until: number }> = {};
  for (const [key, hit] of signed) {
    if (key.startsWith(prefix) && hit.until > now) kept[key.slice(prefix.length)] = hit;
  }
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or blocked. The URLs still serve this page.
  }
}

restoreKept();

/**
 * A small copy's path: same folder, so the same storage rules cover it
 * (`u1/profile-1a2b.webp` → `u1/profile-1a2b.thumb.webp`).
 */
export function thumbPath(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/')
    ? `${path.slice(0, dot)}.thumb${path.slice(dot)}`
    : `${path}.thumb`;
}

/** Small copies storage refused (not made yet); not asked for again while the page lives. */
const missingCopies = new Set<string>();
const isCopy = (path: string) => path.includes('.thumb.');
/** Photographs storage refused, each counted as broken once (a changed photo). */
const refusedPhotos = new Set<string>();

/**
 * A member's face (`<id>/profile-….webp`, `seed/<id>.webp`): the only photo another member can
 * change behind a kept read, so the only one worth re-reading members for.
 */
export function isMemberPhoto(path: string): boolean {
  const [folder, name, ...rest] = path.split('/');
  return (
    rest.length === 0 &&
    folder !== undefined &&
    name !== undefined &&
    (folder === 'seed' || (folder !== 'organizations' && name.startsWith('profile')))
  );
}

/** Whether storage has said this small copy is not there. */
export function copyMissing(bucket: SignedBucket, path: string): boolean {
  return missingCopies.has(cacheKey(bucket, path));
}

/** For tests, and for a sign-out: nothing signed for one member serves the next. */
export function resetAttachmentUrls(): void {
  signed.clear();
  missingCopies.clear();
  refusedPhotos.clear();
  queued.clear();
  inFlight.clear();
  try {
    localStorage.removeItem(KEPT_KEY);
  } catch {
    // Nothing was kept where storage is blocked.
  }
}

/** Drop these paths' URLs, so the next ask signs again (or finds no file). */
export function forgetSignedUrls(bucket: SignedBucket, paths: readonly string[]): void {
  for (const path of paths) {
    signed.delete(cacheKey(bucket, path));
    missingCopies.delete(cacheKey(bucket, path));
  }
  if (bucket === KEPT_BUCKET) saveKept();
}

/** What the cache already holds for these paths, unexpired. */
function cachedUrls(bucket: SignedBucket, paths: readonly string[]): Map<string, string> {
  const now = Date.now();
  const out = new Map<string, string>();
  for (const path of paths) {
    const hit = signed.get(cacheKey(bucket, path));
    if (hit && hit.until > now) out.set(path, hit.url);
  }
  return out;
}

/**
 * Paths asked for before the next event-loop turn, signed in one `createSignedUrls` per bucket,
 * so a screen of faces is one round trip rather than one per face.
 */
const queued = new Map<SignedBucket, { paths: Set<string>; done: Promise<void> }>();
/** A path already being signed is waited on, not asked for twice. */
const inFlight = new Map<string, Promise<void>>();

function enqueue(bucket: SignedBucket, paths: readonly string[]): Promise<void> {
  let batch = queued.get(bucket);
  if (!batch) {
    const fresh = { paths: new Set<string>(), done: Promise.resolve() };
    fresh.done = new Promise<void>((resolve) => {
      setTimeout(() => {
        queued.delete(bucket);
        void sign(bucket, [...fresh.paths]).finally(resolve);
      }, 0);
    });
    queued.set(bucket, fresh);
    batch = fresh;
  }
  for (const path of paths) {
    batch.paths.add(path);
    inFlight.set(cacheKey(bucket, path), batch.done);
  }
  return batch.done;
}

async function sign(bucket: SignedBucket, paths: string[]): Promise<void> {
  const now = Date.now();
  try {
    const { data } = await getSupabase()
      .storage.from(bucket)
      .createSignedUrls(paths, SIGNED_FOR_SECONDS);
    for (const row of data ?? []) {
      // A refused path has no URL and is not drawn, as if deleted.
      if (row.signedUrl && row.path) {
        signed.set(cacheKey(bucket, row.path), { url: row.signedUrl, until: now + CACHE_FOR_MS });
      } else if (row.path && isCopy(row.path)) {
        missingCopies.add(cacheKey(bucket, row.path));
      } else if (
        row.path &&
        bucket === KEPT_BUCKET &&
        isMemberPhoto(row.path) &&
        !refusedPhotos.has(row.path)
      ) {
        // Likely another member's old file, deleted by a change: read again.
        refusedPhotos.add(row.path);
        signed.delete(cacheKey(bucket, row.path));
        photoBroke();
      }
    }
  } catch {
    // Offline or failed: initials or the tile are drawn; the next ask tries again.
  } finally {
    for (const path of paths) inFlight.delete(cacheKey(bucket, path));
  }
  if (bucket === KEPT_BUCKET) saveKept();
}

async function signUrls(bucket: SignedBucket, paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const waits = new Set<Promise<void>>();
  const missing: string[] = [];
  for (const path of paths) {
    const hit = signed.get(cacheKey(bucket, path));
    if ((hit && hit.until > now) || missingCopies.has(cacheKey(bucket, path))) continue;
    const pending = inFlight.get(cacheKey(bucket, path));
    if (pending) waits.add(pending);
    else missing.push(path);
  }
  if (missing.length > 0) waits.add(enqueue(bucket, missing));
  await Promise.all(waits);
  return cachedUrls(bucket, paths);
}

const NONE = new Map<string, string>();

/**
 * Signed URLs for the paths given, as they arrive; a path with no URL is absent. Cached URLs are
 * there on the first render, so a face does not blink to its initials.
 */
export function useAttachmentUrls(
  paths: readonly string[],
  bucket: SignedBucket = CHAT_BUCKET,
): Map<string, string> {
  // Keyed on the paths themselves: the array is a new identity every render.
  const key = paths.join('\n');
  const [arrived, setArrived] = useState<{ key: string; urls: Map<string, string> }>(() => ({
    key,
    urls: key ? cachedUrls(bucket, key.split('\n')) : NONE,
  }));

  useEffect(() => {
    if (!key) return;
    let live = true;
    void signUrls(bucket, key.split('\n')).then((urls) => {
      if (live) setArrived({ key, urls });
    });
    return () => {
      live = false;
    };
  }, [key, bucket]);

  if (!key) return NONE;
  return arrived.key === key ? arrived.urls : cachedUrls(bucket, key.split('\n'));
}

/**
 * Each photograph's small copy and the photograph itself, signed in one
 * request. `small` has the copy, or the photograph once storage says there
 * is no copy (one uploaded before copies were made); `full` the photograph.
 */
export function useSmallCopies(
  paths: readonly string[],
  bucket: SignedBucket = CHAT_BUCKET,
): { small: Map<string, string>; full: Map<string, string> } {
  const full = useAttachmentUrls(
    paths.flatMap((path) => [thumbPath(path), path]),
    bucket,
  );
  const small = new Map<string, string>();
  for (const path of paths) {
    const copy = thumbPath(path);
    const url = full.get(copy) ?? (copyMissing(bucket, copy) ? full.get(path) : undefined);
    if (url) small.set(path, url);
  }
  return { small, full };
}
