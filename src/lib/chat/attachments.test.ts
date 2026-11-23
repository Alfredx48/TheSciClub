import { describe, expect, it } from 'vitest';
import {
  attachmentFolder,
  attachmentProblem,
  isMemberPhoto,
  MAX_ATTACHMENTS,
  MAX_SOURCE_BYTES,
} from '@/lib/chat/attachments';

/**
 * The limits, held here so the picker cannot quietly loosen one. The row and
 * the bucket hold the same limits on the server — chat-attachments.sql and
 * check-chat-photo-policy.mjs are the tests for those.
 */

const photo = (name = 'a.jpg', size = 1000, type = 'image/jpeg'): File =>
  new File([new Uint8Array(size)], name, { type });

describe('attachmentProblem', () => {
  it('has nothing to say about a few photographs', () => {
    expect(attachmentProblem([photo(), photo('b.png', 5, 'image/png')], 0)).toBeNull();
  });

  it('has nothing to say about no files at all', () => {
    expect(attachmentProblem([], 3)).toBeNull();
  });

  it('refuses one past the most, counting what is already attached', () => {
    expect(attachmentProblem([photo()], MAX_ATTACHMENTS)).toMatch(/Up to 50 photographs/);
    expect(attachmentProblem([photo(), photo()], MAX_ATTACHMENTS - 1)).toMatch(/Up to 50/);
    expect(attachmentProblem([photo()], MAX_ATTACHMENTS - 1)).toBeNull();
  });

  it('refuses a file that is not a photograph, and says a video can be linked', () => {
    expect(attachmentProblem([photo('clip.mp4', 10, 'video/mp4')], 0)).toMatch(
      /not a photograph.*video can be linked/,
    );
  });

  // Before the file is read, not after: decoding a 40MB photograph on a phone
  // takes long enough that the refusal has to come first.
  it('refuses a file over 10MB before anything looks inside it', () => {
    expect(attachmentProblem([photo('huge.jpg', MAX_SOURCE_BYTES + 1)], 0)).toMatch(/over 10MB/);
    expect(attachmentProblem([photo('fine.jpg', MAX_SOURCE_BYTES)], 0)).toBeNull();
  });

  it('names the file in the sentence, or says "that file" when it has no name', () => {
    expect(attachmentProblem([photo('scan.pdf', 10, 'application/pdf')], 0)).toMatch(/scan\.pdf/);
    expect(attachmentProblem([photo('', 10, 'text/plain')], 0)).toMatch(/That file/);
  });
});

describe('attachmentFolder', () => {
  // The second folder is what the read policy checks — see 20260918200000.
  it('puts a thread photograph under threads/ and a room photograph under rooms/', () => {
    expect(attachmentFolder('thread', 'abc')).toBe('threads/abc');
    expect(attachmentFolder('room', 'bowel')).toBe('rooms/bowel');
  });
});

describe('isMemberPhoto', () => {
  it('is a face, and not a logo, an event picture or a review picture', () => {
    expect(isMemberPhoto('0b6e6c1a-1111-4f00-9f00-000000000001/profile-1a2b.webp')).toBe(true);
    expect(isMemberPhoto('u1/profile.jpg')).toBe(true);
    expect(isMemberPhoto('seed/c85c10bf.webp')).toBe(true);
    expect(isMemberPhoto('organizations/aby.png')).toBe(false);
    expect(isMemberPhoto('organizations/o1/5c1e.webp')).toBe(false);
    expect(isMemberPhoto('events/e1/9f2a.webp')).toBe(false);
    expect(isMemberPhoto('reviews/r1/77aa.jpg')).toBe(false);
  });
});
