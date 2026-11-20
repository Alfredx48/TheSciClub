import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { forgetDrafts } from '@/lib/chat/drafts';
import {
  draftMediaGeneration,
  mayHaveDraftMedia,
  readDraftMedia,
  writeDraftMedia,
} from '@/lib/draft-media';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('keeps photo drafts separate and clears queued photos on sign-out', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const scope = draftMediaGeneration();
  const event = 'alice:new-event';
  const org = 'alice:new-organization';
  const photo = { bytes: new Uint8Array([1, 2, 3]), alt: 'Step-free entrance' };

  expect(await writeDraftMedia(event, photo, scope)).toBe(true);
  const restored = (await readDraftMedia(event)) as typeof photo | undefined;
  expect(Array.from(restored?.bytes ?? [])).toEqual([1, 2, 3]);
  expect(restored?.alt).toBe(photo.alt);
  expect(await readDraftMedia('bob:new-event')).toBeUndefined();
  expect(mayHaveDraftMedia(event)).toBe(true);

  const pendingLogo = writeDraftMedia(org, photo, scope);
  const signOut = forgetDrafts();
  expect(await writeDraftMedia(event, photo, scope)).toBe(false);
  await Promise.all([signOut, pendingLogo]);
  expect(await readDraftMedia(event)).toBeUndefined();
  expect(await readDraftMedia(org)).toBeUndefined();
  expect(mayHaveDraftMedia(event)).toBe(false);
  expect(mayHaveDraftMedia(org)).toBe(false);
});
