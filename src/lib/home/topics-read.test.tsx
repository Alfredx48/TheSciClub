import { act, render, renderHook, waitFor } from '@testing-library/react';
import { Activity } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountContext } from '@/lib/account-context';
import { useChatAuthors } from '@/lib/chat/authors';
import { HOME_TOPIC_LIMIT, useHomeTopics } from '@/lib/home/topics';
import { keptReadsStale } from '@/lib/kept-reads';

const db = vi.hoisted(() => ({
  /** What `home_feed` answers; null is a database without it. */
  feed: null as unknown[] | null,
  rpcs: [] as string[],
  calls: [] as unknown[][],
  includeHidden: false,
  includeClosed: false,
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: (name: string) => ({
      abortSignal: () => {
        db.rpcs.push(name);
        return Promise.resolve(
          name === 'home_feed' && db.feed
            ? { data: db.feed, error: null }
            : { data: null, error: { code: 'PGRST202', message: 'no such function' } },
        );
      },
    }),
    from: (table: string) => {
      const query = {
        select: (columns: string) => {
          db.calls.push(['select', columns]);
          return query;
        },
        eq: (column: string, value: unknown) => {
          db.calls.push(['eq', column, value]);
          if (column === 'chat_rooms.show_in_home' && value === true) db.includeHidden = false;
          return query;
        },
        not: (column: string, operator: string, value: unknown) => {
          db.calls.push(['not', column, operator, value]);
          if (column === 'chat_rooms.opened_at' && operator === 'is' && value === null)
            db.includeClosed = false;
          return query;
        },
        order: () => query,
        limit: (count: number) => {
          db.calls.push(['limit', count]);
          return query;
        },
        in: () => query,
        is: () => query,
        abortSignal: () =>
          Promise.resolve({
            data:
              table === 'chat_topics'
                ? [
                    {
                      id:
                        db.includeHidden || db.includeClosed
                          ? 'excluded-newest-topic'
                          : 'eligible-topic',
                      room_id: 'bowel',
                      title: 'Eligible topic',
                      author_id: 'a1',
                      author: {
                        id: 'a1',
                        display_name: 'Ana',
                        photo_path: null,
                        photo_alt: null,
                        avatar_color: null,
                        level_range: 'C5–C8',
                        exact_level: null,
                        is_admin: false,
                        has_profile: true,
                      },
                      created_at: '2026-10-10T10:00:00Z',
                      last_post_at: '2026-10-10T10:00:00Z',
                      reply_count: 0,
                    },
                  ]
                : [],
            error: null,
          }),
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  db.feed = null;
  db.rpcs = [];
  db.calls = [];
  db.includeHidden = true;
  db.includeClosed = true;
});

it('reuses the pending cold Home feed across the development effect replay', async () => {
  const feed = Promise.resolve([]);
  const takeInitialHomeFeed = vi.fn<() => Promise<unknown[]> | undefined>();
  takeInitialHomeFeed.mockReturnValueOnce(feed);
  const { result } = renderHook(() => useHomeTopics(), {
    reactStrictMode: true,
    wrapper: ({ children }) => (
      <AccountContext.Provider
        value={{
          status: 'member',
          userId: 'a1',
          isAdmin: false,
          displayName: 'Ana',
          takeInitialHomeFeed,
        }}
      >
        {children}
      </AccountContext.Provider>
    ),
  });
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
  expect(result.current.error).toBeNull();
  expect(takeInitialHomeFeed).toHaveBeenCalledTimes(1);
  expect(db.rpcs).toEqual([]);
});

it('requests only eligible rooms before limiting Home topics, including for an admin', async () => {
  const { result } = renderHook(() => useHomeTopics());
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
  expect(result.current.error).toBeNull();
  expect(result.current.topics.map((t) => t.id)).toEqual(['eligible-topic']);
  expect(db.calls[0]?.[1]).toContain('chat_rooms!inner');
  expect(db.calls.slice(1, 4)).toEqual([
    ['eq', 'chat_rooms.show_in_home', true],
    ['not', 'chat_rooms.opened_at', 'is', null],
    ['limit', HOME_TOPIC_LIMIT],
  ]);
});

it('brings the cards’ names and faces in the same read, ready on the first render', async () => {
  // As Home asks: the authors of whatever topics have arrived.
  const unnamed: string[] = [];
  const { result } = renderHook(() => {
    const read = useHomeTopics();
    const authors = useChatAuthors(read.topics.map((topic) => topic.authorId));
    for (const topic of read.topics) {
      if (topic.authorId && !authors.has(topic.authorId)) unnamed.push(topic.id);
    }
    return { read, authors };
  });
  await waitFor(() => {
    expect(result.current.read.loading).toBe(false);
  });
  expect(db.calls[0]?.[1]).toContain('author:chat_authors!chat_topics_author_id_fkey(');
  expect(db.calls[0]?.[1]).toContain('author:chat_authors!chat_posts_author_id_fkey(');
  expect(result.current.authors.get('a1')?.displayName).toBe('Ana');
  // Never a render with the topic and not its author.
  expect(unnamed).toEqual([]);
  // And nothing read for an author already known.
  expect(db.calls.filter(([kind]) => kind === 'select')).toHaveLength(1);
});

// The owner, 2026-11-18: the posts were asked for only once the ranking had
// answered, and their text waited for both. One request now says which posts,
// in what order, and carries all a card is drawn from.
it('reads the order, the posts and their authors in one request', async () => {
  const post = (id: string, at: string, author: string) => ({
    id,
    topic_id: 'second',
    author_id: author,
    body: id,
    attachments: [],
    created_at: at,
    removed_at: null,
    removed_by_admin: false,
    edited_at: null,
    reply_to: null,
    link_preview: null,
  });
  const card = (id: string, ord: number, more: object = {}) => ({
    id,
    room_id: 'bowel',
    title: id,
    author_id: 'a1',
    created_at: '2026-10-10T10:00:00Z',
    last_post_at: '2026-10-10T10:00:00Z',
    reply_count: 0,
    is_question: false,
    ord,
    room: {
      id: 'bowel',
      name: 'Bowel care',
      description: '',
      category: 'Body',
      icon: null,
      sort_order: 1,
      opened_at: '2026-10-10T10:00:00Z',
      show_in_home: true,
      created_by: null,
    },
    previews: [],
    author: { id: 'a1', display_name: 'Ana' },
    opening: [],
    replies: [],
    ...more,
  });
  // Sent out of order: the place is in each card, not in where it came.
  db.feed = [
    card('second', 1, {
      previews: [{ id: 'answer', kind: 'latest' }],
      opening: [post('question', '2026-10-10T10:00:00Z', 'a1')],
      replies: [
        {
          ...post('answer', '2026-10-10T11:00:00Z', 'b2'),
          author: { id: 'b2', display_name: 'Bo' },
        },
      ],
    }),
    card('first', 0),
  ];
  const { result } = renderHook(() => {
    const read = useHomeTopics();
    // As Home asks: the authors of what has arrived, replies included.
    return { read, authors: useChatAuthors(read.posts.map((each) => each.authorId)) };
  });
  await waitFor(() => {
    expect(result.current.read.loading).toBe(false);
  });
  expect(db.rpcs).toEqual(['home_feed']);
  expect(db.calls).toEqual([]);
  expect(result.current.read.topics.map((topic) => [topic.id, topic.order])).toEqual([
    ['second', 1],
    ['first', 0],
  ]);
  expect(result.current.read.topics[0]?.previewIds).toEqual([{ id: 'answer', kind: 'latest' }]);
  expect(result.current.read.rooms).toMatchObject([{ id: 'bowel', name: 'Bowel care' }]);
  expect(result.current.read.posts.map((each) => each.id)).toEqual(['question', 'answer']);
  expect(result.current.authors.get('b2')?.displayName).toBe('Bo');
});

// From 2026-11-18's filter until this, every read blanked Home to its
// placeholders, also the one a kept tab makes when it is shown again after a
// minute: the owner saw Home go empty for over a second each time he came back.
it('keeps its cards while it reads the same choice again', async () => {
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useHomeTopics().loading);
    return null;
  }
  const tab = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <Probe />
    </Activity>
  );
  const reads = () => db.calls.filter(([kind]) => kind === 'select').length;
  const { rerender } = render(tab('visible'));
  await waitFor(() => {
    expect(seen.at(-1)).toBe(false);
  });
  expect(reads()).toBe(1);

  seen.length = 0;
  rerender(tab('hidden'));
  act(() => {
    keptReadsStale();
  });
  rerender(tab('visible'));
  await waitFor(() => {
    expect(reads()).toBe(2);
  });
  expect(seen).not.toContain(true);
});
