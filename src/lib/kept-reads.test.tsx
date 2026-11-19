import { act, render } from '@testing-library/react';
import { Activity, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/account';
import { AccountContext } from '@/lib/account-context';
import { useSignInDetails } from '@/lib/account-email';
import { useChatRooms, useRoomStats } from '@/lib/chat/rooms';
import { useMyThreads } from '@/lib/chat/threads';
import { useIAmPartner, useICanConnect } from '@/lib/club-partners';
import { useEvents, useViewerEvents } from '@/lib/events';
import { useHomeTopics } from '@/lib/home/topics';
import { useInvitePermissions } from '@/lib/invite-permissions';
import { isWrite, KEPT_FRESH_MS, keptReadsStale, noticeWrites } from '@/lib/kept-reads';
import { useOwnMember } from '@/lib/members';
import { useOrganizationFollows } from '@/lib/organization-follows';
import { useMyOrganizations } from '@/lib/organization-representatives';

/** A kept tab shown again: its requests, counted (free plan, 2026-11-05). */

const db = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock('@/lib/supabase', () => {
  // Any chain of query methods, answering empty when awaited.
  const chain = (name: string): unknown => {
    const answer = () => {
      db.requests.push(name);
      return Promise.resolve({ data: name === 'members' ? null : [], error: null });
    };
    const query: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              answer().then(resolve, reject);
          }
          if (key === 'maybeSingle' || key === 'single') return answer;
          return () => query;
        },
      },
    );
    return query;
  };
  return {
    getSupabase: () => ({
      auth: {
        getUser: () => {
          db.requests.push('auth:user');
          return Promise.resolve({ data: { user: { id: 'me', identities: [] } }, error: null });
        },
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'me' } } } }),
      },
      from: (table: string) => chain(table),
      rpc: (fn: string) => chain(`rpc:${fn}`),
    }),
  };
});

const member: Account = {
  status: 'member',
  userId: 'me',
  isAdmin: false,
  displayName: 'Dana',
};

/** Every read Home, Chat, Events and Me make on a show (not the 60 s caches). */
function TabReads() {
  useHomeTopics();
  useChatRooms();
  useRoomStats();
  useMyThreads();
  useEvents({ from: '2026-11-05T00:00:00Z' });
  useViewerEvents('me');
  useOrganizationFollows();
  useMyOrganizations('me');
  useInvitePermissions('me');
  useIAmPartner('me');
  useICanConnect('me');
  useOwnMember('me');
  useSignInDetails();
  return null;
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};

function renderTab() {
  const tab = (mode: 'visible' | 'hidden'): ReactNode => (
    <AccountContext.Provider value={member}>
      <Activity mode={mode}>
        <TabReads />
      </Activity>
    </AccountContext.Provider>
  );
  const view = render(tab('visible'));
  return {
    async showAgain() {
      view.rerender(tab('hidden'));
      await settle();
      db.requests = [];
      view.rerender(tab('visible'));
      await settle();
      return db.requests.length;
    },
    names: () => [...db.requests].sort(),
  };
}

/** Kept five minutes by their own cache, not by the tab. */
const ELSEWHERE = new Set(['tags', 'data_feeds']);

async function readsAgain(tab: ReturnType<typeof renderTab>, first: string[]) {
  await tab.showAgain();
  expect(tab.names()).toEqual(first.filter((name) => !ELSEWHERE.has(name)));
}

afterEach(() => {
  vi.restoreAllMocks();
  db.requests = [];
});

describe('a kept tab shown again', () => {
  it('asks nothing when switched back to within the minute', async () => {
    const tab = renderTab();
    await settle();
    // 17 on a show (Home's posts are one, `home_feed`, where the ranking and then
    // the posts were two; 20261118260000); before, 14 of them again on every switch.
    expect(db.requests).toHaveLength(17);
    expect(await tab.showAgain()).toBe(0);
  });

  it('reads again once another screen was open', async () => {
    const tab = renderTab();
    await settle();
    const first = tab.names();
    keptReadsStale();
    await readsAgain(tab, first);
  });

  it('reads again after a minute', async () => {
    const tab = renderTab();
    await settle();
    const first = tab.names();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + KEPT_FRESH_MS);
    await readsAgain(tab, first);
  });

  it('reads again after this device wrote something', async () => {
    const tab = renderTab();
    await settle();
    const first = tab.names();
    const fetched = noticeWrites(() => Promise.resolve(new Response('{}')));
    await fetched('https://x.supabase.co/rest/v1/event_rsvps', { method: 'POST' });
    await readsAgain(tab, first);
  });
});

describe('what counts as a write', () => {
  const at = (path: string) => `https://x.supabase.co${path}`;
  it('is any insert, change or unknown call', () => {
    expect(isWrite('POST', at('/rest/v1/chat_posts'))).toBe(true);
    expect(isWrite('PATCH', at('/rest/v1/members?id=eq.me'))).toBe(true);
    expect(isWrite('DELETE', at('/rest/v1/chat_saves?id=eq.1'))).toBe(true);
    expect(isWrite('POST', at('/rest/v1/rpc/chat_create_topic'))).toBe(true);
    expect(isWrite('POST', at('/rest/v1/rpc/something_new'))).toBe(true);
    expect(isWrite('POST', at('/storage/v1/object/photos/me/a.webp'))).toBe(true);
    expect(isWrite('PUT', at('/auth/v1/user'))).toBe(true);
  });

  it('is not a read, a read by call, a signed address or a seen mark', () => {
    expect(isWrite('GET', at('/rest/v1/chat_rooms'))).toBe(false);
    expect(isWrite('HEAD', at('/rest/v1/chat_rooms'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/chat_my_threads'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/chat_post_scores'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/home_feed'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/home_topics_ranked'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/home_topics_shown'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/admin_boost_post'))).toBe(true);
    expect(isWrite('POST', at('/rest/v1/rpc/my_badge_counts'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/map_events'))).toBe(false);
    expect(isWrite('POST', at('/rest/v1/rpc/chat_mark_posts_seen'))).toBe(false);
    expect(isWrite('POST', at('/storage/v1/object/sign/photos'))).toBe(false);
    expect(isWrite('POST', at('/auth/v1/token?grant_type=refresh_token'))).toBe(false);
  });
});
