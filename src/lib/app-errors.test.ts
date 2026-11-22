import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteError, resetAppErrors, scrub, sourceOf, startAppErrors } from '@/lib/app-errors';

afterEach(() => {
  resetAppErrors();
  vi.useRealTimers();
});

// The owner, 2026-11-22: crashes for administrators, never who. Nothing a
// member typed or anything naming them leaves the phone in the message.
describe('the app reports its crashes', () => {
  it('takes addresses, ids, links and long numbers out of the message', () => {
    expect(
      scrub(
        'Could not load bo@example.com for 3f2b1c9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e at https://x.supabase.co/rest/v1/members?id=eq.3f2b1c9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e (code 4155551234)',
      ),
    ).toBe('Could not load <email> for <id> at https://x.supabase.co/rest/v1/members (code <n>)');
  });

  it('sends each crash once a load, in one batch, with its place in the code', () => {
    vi.useFakeTimers();
    const sent = vi.fn((_errors: unknown[]) => Promise.resolve());
    startAppErrors(sent);
    const error = new TypeError('x is undefined');
    error.stack = `TypeError: x is undefined\n    at f (${window.location.origin}/assets/home-abc.js:12:34)`;
    noteError('error', error);
    noteError('error', error);
    noteError('promise', new Error('Failed to fetch'));
    vi.advanceTimersByTime(3000);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject([
      { kind: 'error', message: 'TypeError: x is undefined', source: 'assets/home-abc.js:12:34' },
    ]);
  });

  it('finds the first line of the app’s own code in a stack', () => {
    expect(
      sourceOf(
        'Error\n at a (https://ext.example/x.js:1:1)\n at b (https://club.test/assets/a.js:2:3)',
        'https://club.test',
      ),
    ).toBe('assets/a.js:2:3');
  });
});
