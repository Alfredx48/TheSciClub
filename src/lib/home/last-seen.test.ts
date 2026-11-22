import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetLastSeen,
  lastHomeFeed,
  lastMember,
  rememberMember,
  saveHomeFeed,
} from '@/lib/home/last-seen';
import { sessionStorageKey } from '@/lib/url-session';

// The owner, 2026-11-21: the app opens on what this device last saw. Only for
// the member whose session it holds, and nothing of theirs after sign-out.
const URL = 'https://test-ref.supabase.co';

describe('what this device last saw', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', URL);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  const signedInAs = (id: string | null) => {
    if (id) localStorage.setItem(sessionStorageKey(URL), JSON.stringify({ user: { id } }));
    else localStorage.removeItem(sessionStorageKey(URL));
  };

  it('lets in only the member whose session this device holds', () => {
    rememberMember({ userId: 'u1', isAdmin: false, displayName: 'Jan' });
    signedInAs('u1');
    expect(lastMember()).toEqual({ userId: 'u1', isAdmin: false, displayName: 'Jan' });
    signedInAs('u2');
    expect(lastMember()).toBeNull();
    signedInAs(null);
    expect(lastMember()).toBeNull();
  });

  it('keeps each member their own feed, and forgets every one at sign-out', () => {
    saveHomeFeed('u1', [{ id: 't1' }]);
    saveHomeFeed('u2', [{ id: 't2' }]);
    expect(lastHomeFeed('u1')).toEqual([{ id: 't1' }]);
    expect(lastHomeFeed('u3')).toBeNull();
    rememberMember({ userId: 'u1', isAdmin: true, displayName: null });
    forgetLastSeen();
    signedInAs('u1');
    expect(lastMember()).toBeNull();
    expect(lastHomeFeed('u1')).toBeNull();
    expect(lastHomeFeed('u2')).toBeNull();
  });

  it('does not open on a feed more than a week old', () => {
    localStorage.setItem(
      'club:home-feed:u1',
      JSON.stringify({ at: Date.now() - 8 * 24 * 60 * 60 * 1000, rows: [{ id: 't1' }] }),
    );
    expect(lastHomeFeed('u1')).toBeNull();
  });
});
