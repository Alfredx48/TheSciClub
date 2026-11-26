import { readKeptDraft, writeDraft } from '@/lib/chat/drafts';
import {
  draftMediaGeneration,
  mayHaveDraftMedia,
  readDraftMedia,
  writeDraftMedia,
} from '@/lib/draft-media';

/**
 * A second unfinished post, kept beside the one being written (the owner,
 * 2026-11-26: "I just tried to create a new post and when I hit add Details it
 * brought up my previous post. I should be adding Details to a question I was
 * in the middle of asking").
 *
 * The full form keeps one draft per kind of post, so "Add details or a photo"
 * from the quick box used to open on whatever was left there. Now the words
 * carried over win, and the unfinished post moves here, words and photographs,
 * for the form to offer back. One is kept: setting another aside replaces it.
 */
export function otherDraftKey(key: string) {
  return `${key}:other`;
}

/** A saved full-form draft's fields, or null when there is none that reads. */
export function savedPost(key: string | undefined): Record<string, unknown> | null {
  const stored = readKeptDraft(key);
  if (!stored) return null;
  try {
    const saved = JSON.parse(stored.text) as { version?: unknown; value?: unknown } | null;
    if (saved?.version === 1 && saved.value && typeof saved.value === 'object')
      return saved.value as Record<string, unknown>;
  } catch {
    // Not a full-form draft.
  }
  return null;
}

/** The quick box's words a draft was started from; its title if it was not. */
function askedAs(saved: Record<string, unknown> | null): string | null {
  if (!saved) return null;
  if (typeof saved.askedAs === 'string' && saved.askedAs) return saved.askedAs;
  return typeof saved.title === 'string' ? saved.title : null;
}

/** Whether what is saved under `key` is some other post than `words`. */
export function holdsOtherPost(key: string | undefined, words: string): boolean {
  if (!key || !words) return false;
  const saved = savedPost(key);
  if (saved) return askedAs(saved) !== words;
  // Photographs with no words yet are some other post's too.
  return readKeptDraft(key) !== null || mayHaveDraftMedia(key);
}

/** Exchange two drafts, words and photographs. */
export async function swapDrafts(a: string, b: string) {
  const scope = draftMediaGeneration();
  const read = (key: string) =>
    mayHaveDraftMedia(key)
      ? readDraftMedia(key).catch(() => undefined)
      : Promise.resolve(undefined);
  const [mediaA, mediaB] = await Promise.all([read(a), read(b)]);
  const wordsA = readKeptDraft(a)?.text ?? '';
  const wordsB = readKeptDraft(b)?.text ?? '';
  writeDraft(a, wordsB);
  writeDraft(b, wordsA);
  await writeDraftMedia(a, mediaB, scope);
  await writeDraftMedia(b, mediaA, scope);
}

const moving = new Map<string, Promise<void>>();

/**
 * Clear `key` for the quick box's `words`: what was there moves to the other
 * draft. If the other draft is the post these words started, it comes back.
 */
export function setAsideFor(key: string, words: string): Promise<void> {
  const running = moving.get(key);
  if (running) return running;
  const other = otherDraftKey(key);
  const task = (async () => {
    const returning = askedAs(savedPost(other)) === words;
    await swapDrafts(key, other);
    if (!returning) {
      writeDraft(key, '');
      await writeDraftMedia(key, undefined, draftMediaGeneration());
    }
  })().finally(() => {
    moving.delete(key);
  });
  moving.set(key, task);
  return task;
}
