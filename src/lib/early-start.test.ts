import { afterEach, describe, expect, it } from 'vitest';
import { takeEarlyStart } from '@/lib/early-start';

// The owner, 2026-11-21: Home's door check and feed asked for by index.html.
describe('the reads index.html starts', () => {
  afterEach(() => {
    window.__clubEarly = undefined;
  });

  const start = (user: string, at = Date.now()) => {
    window.__clubEarly = {
      user,
      at,
      member: Promise.resolve([{ id: user, status: 'active' }]),
      feed: Promise.resolve([{ id: 'topic' }]),
    };
  };

  it('are taken once, and only for the member whose session started them', async () => {
    start('u1');
    expect(takeEarlyStart('u2')).toBeUndefined();
    // Gone once looked at, even by somebody else.
    expect(takeEarlyStart('u1')).toBeUndefined();
    start('u1');
    const early = takeEarlyStart('u1');
    expect(await early?.member).toEqual({ id: 'u1', status: 'active' });
    expect(await early?.feed).toEqual([{ id: 'topic' }]);
    expect(takeEarlyStart('u1')).toBeUndefined();
  });

  it('are not taken once the page has been open a while', () => {
    start('u1', Date.now() - 60_000);
    expect(takeEarlyStart('u1')).toBeUndefined();
  });

  it('say there is no row, not a member yet, and leave a failed feed to be read again', async () => {
    window.__clubEarly = {
      user: 'u1',
      at: Date.now(),
      member: Promise.resolve([]),
      feed: Promise.reject(new Error('401')),
    };
    const early = takeEarlyStart('u1');
    expect(await early?.member).toBeNull();
    expect(await early?.feed).toBeNull();
  });
});
