import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Attachments from '@/lib/chat/attachments';
import type * as MessageSearch from '@/lib/chat/message-search';
import type * as ChatRooms from '@/lib/chat/rooms';
import type * as Threads from '@/lib/chat/threads';
import type { ChatAuthor, ChatRoom, ChatThread, RoomStats } from '@/lib/chat/types';
import ChatPage from '@/routes/chat/page';

/**
 * What this screen must not do is as important as what it does: it must not
 * report an empty room as three zeros, and it must not leave an empty segment
 * as blank space — every blank here says where to go next, and where to go is
 * different in each segment.
 *
 * The hooks that read the database are stubbed and `roomsByCategory` and
 * `threadTitle` deliberately are not — the grouping on screen is the real
 * function's, so this file cannot assert its own arithmetic. Their own tests
 * are in src/lib/chat/rooms.test.ts and threads.test.ts.
 */

const db = vi.hoisted(() => ({
  subscribed: [] as string[],
  rooms: [] as ChatRoom[],
  loading: false,
  error: null as string | null,
  stats: new Map<string, RoomStats>(),
  threads: [] as ChatThread[],
  threadsLoading: false,
  threadsError: null as string | null,
  authors: new Map<string, ChatAuthor>(),
  /** Signed URLs for group pictures, by path. */
  urls: new Map<string, string>(),
  /** What a message search finds, for any words. */
  hits: [] as MessageSearch.MessageHit[],
}));

// Stubbed for the same reason as realtime below: unmocked, it reads production.
vi.mock('@/lib/chat/message-search', async (importOriginal) => ({
  ...(await importOriginal<typeof MessageSearch>()),
  useMessageSearch: (query: string) => {
    return {
      hits: query ? db.hits : [],
      searching: false,
      error: null,
      more: false,
      loadingMore: false,
      showMore: vi.fn(),
    };
  },
}));

// Signing is a storage call under the reader's token; stubbed, as the grid's
// own test does.
vi.mock('@/lib/chat/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof Attachments>()),
  useAttachmentUrls: (paths: readonly string[]) =>
    new Map([...db.urls].filter(([path]) => paths.includes(path))),
  // No small copies here: tiles and viewer draw the same URL.
  useSmallCopies: (paths: readonly string[]) => {
    const found = new Map([...db.urls].filter(([path]) => paths.includes(path)));
    return { small: found, full: found };
  },
}));

vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: 'member', userId: 'me', isAdmin: false, displayName: 'Alex' }),
}));

vi.mock('@/lib/chat/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof Threads>()),
  useMyThreads: () => ({
    threads: db.threads,
    loading: db.threadsLoading,
    error: db.threadsError,
    reload: () => undefined,
  }),
}));

vi.mock('@/lib/chat/authors', () => ({
  useChatAuthors: () => db.authors,
}));

// Stubbed, and it has to be: `.env.local` points at the hosted project, so an
// unmocked subscription in a test opens a websocket to production. What the
// hook does is its own concern — the screen's job here is to hand it a refetch.
vi.mock('@/lib/chat/realtime', () => ({
  useRealtimeRows: ({ table }: { table: string }) => {
    db.subscribed.push(table);
  },
}));

vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRooms>()),
  useChatRooms: () => ({
    rooms: db.rooms,
    loading: db.loading,
    error: db.error,
    reload: () => undefined,
  }),
  useRoomStats: () => ({ stats: db.stats, loading: false, reload: () => undefined }),
}));

const thread = (o: Partial<ChatThread> & { id: string }): ChatThread => ({
  kind: 'direct',
  name: null,
  eventId: null,
  createdAt: '2026-09-18T09:00:00Z',
  lastMessageAt: '2026-09-18T10:00:00Z',
  memberCount: 2,
  otherMemberId: 'jan',
  lastBody: 'The seat took three fittings.',
  lastAuthorId: 'jan',
  lastAt: '2026-09-18T10:00:00Z',
  lastRemoved: false,
  unread: false,
  photoPath: null,
  lastNotice: null,
  ...o,
});

const author = (o: Partial<ChatAuthor> & { id: string }): ChatAuthor => ({
  displayName: 'Jan',
  username: null,
  photoPath: null,
  photoAlt: null,
  avatarColor: null,
  level: 'T4 complete',
  isAdmin: false,
  hasProfile: true,
  ...o,
});

const room = (o: Partial<ChatRoom> & { id: string }): ChatRoom => ({
  name: 'Bowel management',
  description: 'The one nobody talks about anywhere else.',
  category: 'Body',
  icon: '◍',
  sortOrder: 1,
  showInHome: true,
  openedAt: '2026-09-18T10:00:00Z',
  createdBy: null,
  ...o,
});

function renderPage(entry = '/chat') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ChatPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.urls = new Map();
  db.rooms = [];
  db.loading = false;
  db.error = null;
  db.stats = new Map();
  db.threads = [];
  db.threadsLoading = false;
  db.threadsError = null;
  db.authors = new Map([['jan', author({ id: 'jan' })]]);
  db.subscribed = [];
  db.hits = [];
});

describe('the chat screen', () => {
  // Display is on Me only (the owner, 2026-10-22).
  it('has no Display button in its header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Display settings' })).toBeNull();
  });

  // Two different blanks with two different ways out. A direct conversation
  // starts from somebody's profile and a group starts here, so neither empty
  // state is a dead end and neither points at the other one's door.
  it('points somebody with no conversations at a profile, and at the group control', () => {
    renderPage();
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
    expect(screen.getByText(/Message a member from their profile/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a group' })).toHaveAttribute(
      'href',
      '/chat/new-group',
    );
  });

  it('says "no groups" under Groups, not "no conversations"', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(screen.getByText(/No groups yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Start a group' })).toBeInTheDocument();
  });

  // The rooms segment is not about conversations at all, so the one control
  // that makes one has no business being there.
  it('offers no group control under Rooms', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    expect(screen.queryByRole('link', { name: 'Start a group' })).toBeNull();
  });

  it('opens a conversation, named by the other member', () => {
    db.threads = [thread({ id: 'th1' })];
    renderPage();
    const row = screen.getByRole('link', { name: /Jan/ });
    expect(row).toHaveAttribute('href', '/chat/t/th1');
    // Not "Jan: …" — the row is already titled Jan, and saying it twice spends
    // a third of the line on nothing.
    expect(within(row).getByText('The seat took three fittings.')).toBeInTheDocument();
  });

  // Tapping Message on a profile makes the thread before anything is said in
  // it. Until somebody says something, the other person is not "in your
  // chats"; tapping Message again reopens the same thread.
  it('leaves out a conversation nobody has spoken in', () => {
    db.threads = [thread({ id: 'th1', lastBody: null, lastAuthorId: null, lastAt: null })];
    renderPage();
    expect(screen.queryByRole('link', { name: /Jan/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
  });

  it('lists a group from the moment it is made, spoken in or not', () => {
    db.threads = [
      thread({
        id: 'g1',
        kind: 'group',
        name: 'Saturday ride',
        otherMemberId: null,
        lastBody: null,
        lastAuthorId: null,
        lastAt: null,
      }),
    ];
    renderPage();
    expect(screen.getByRole('link', { name: /Saturday ride/ })).toBeInTheDocument();
  });

  it('names the speaker in a group, where the row is not already titled with it', () => {
    db.threads = [thread({ id: 'g1', kind: 'group', name: 'Saturday ride', otherMemberId: null })];
    renderPage();
    expect(screen.getByText('Jan: The seat took three fittings.')).toBeInTheDocument();
  });

  // A rename's body is the new name. Printed as "Jan: Tuesday swimmers" it
  // would read as something Jan said; the new name is already the title.
  it('says a change to a group as a change, not as the new name', () => {
    db.threads = [
      thread({
        id: 'g1',
        kind: 'group',
        name: 'Tuesday swimmers',
        otherMemberId: null,
        lastBody: 'Tuesday swimmers',
        lastNotice: 'renamed',
      }),
    ];
    renderPage();
    expect(screen.getByText('Jan renamed the group')).toBeInTheDocument();
    expect(screen.queryByText('Jan: Tuesday swimmers')).toBeNull();
  });

  it('draws a group’s picture on its row, and the glyph for one with none', () => {
    db.urls = new Map([['threads/g1/p.webp', 'https://signed/p']]);
    db.threads = [
      thread({
        id: 'g1',
        kind: 'group',
        name: 'Tuesday swimmers',
        otherMemberId: null,
        photoPath: 'threads/g1/p.webp',
      }),
      thread({ id: 'g2', kind: 'group', name: 'Saturday ride', otherMemberId: null }),
    ];
    renderPage();
    const pictured = screen.getByRole('link', { name: /Tuesday swimmers/ });
    expect(pictured.querySelector('img')).toHaveAttribute('src', 'https://signed/p');
    const plain = screen.getByRole('link', { name: /Saturday ride/ });
    expect(plain.querySelector('img')).toBeNull();
    expect(plain).toHaveTextContent('◎');
  });

  it('says "You" when the last word was the viewer’s', () => {
    db.threads = [thread({ id: 'th1', lastAuthorId: 'me', lastBody: 'Thank you.' })];
    renderPage();
    expect(screen.getByText('You: Thank you.')).toBeInTheDocument();
  });

  // The blank the database left is not shown. "Message removed" is the fact.
  it('says a removed last message was removed rather than showing the blank', () => {
    db.threads = [thread({ id: 'th1', lastBody: '', lastRemoved: true })];
    renderPage();
    expect(screen.getByText('Message removed')).toBeInTheDocument();
  });

  it('marks a conversation with something new in it', () => {
    db.threads = [thread({ id: 'th1', unread: true })];
    renderPage();
    // The dot is decorative; the word beside it is what a screen reader gets.
    expect(screen.getByRole('link', { name: /new/ })).toBeInTheDocument();
  });

  // The segment is in the URL, not in component state. Me's ROOMS counter
  // links straight at it, and a member who opens a room and presses back has
  // to land back on Rooms rather than on All.
  it('opens on the segment the link asked for', () => {
    db.threads = [thread({ id: 'th1' })];
    db.rooms = [room({ id: 'bowel' })];
    renderPage('/chat?segment=rooms');
    expect(screen.getByRole('button', { name: 'Rooms' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('link', { name: /Jan/ })).toBeNull();
  });

  it('ignores a segment it does not have', () => {
    db.threads = [thread({ id: 'th1' })];
    renderPage('/chat?segment=nonsense');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps conversations out of the Rooms segment', async () => {
    db.threads = [thread({ id: 'th1' })];
    db.rooms = [room({ id: 'bowel' })];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    expect(screen.queryByRole('link', { name: /Jan/ })).toBeNull();
  });

  // The rooms are all seeded closed, so this is the ordinary first sight of
  // the screen. It explains the policy rather than apologising for a lack of
  // content — the rooms are not missing, they have not been opened — and it
  // says the other half now that a member can start one.
  it('explains that rooms open a few at a time, and that anybody can start one', () => {
    renderPage();
    expect(screen.getByText(/No rooms are open yet/)).toBeInTheDocument();
    expect(screen.getByText(/anybody can start one/)).toBeInTheDocument();
  });

  // Present whether or not there are rooms. A control that only appears when
  // the screen is empty reads as an apology for the emptiness.
  it('offers Start a room with rooms on the screen and without', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Start a room' })).toHaveAttribute(
      'href',
      '/chat/rooms/new',
    );
    cleanup();
    db.rooms = [room({ id: 'bowel' })];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    expect(screen.getByRole('link', { name: 'Start a room' })).toBeInTheDocument();
  });

  // A room a member starts has to reach everybody else's list without them
  // reloading, which is the reason chat_rooms is in the realtime publication
  // at all. The conversations and the topic counts were already live.
  it('listens for rooms as well as messages and topics', () => {
    renderPage();
    expect(db.subscribed).toContain('chat_rooms');
    expect(db.subscribed).toContain('chat_messages');
    expect(db.subscribed).toContain('chat_topics');
  });

  it('names who started a member room, and nobody on a seeded one', () => {
    db.authors = new Map([
      [
        'ada',
        {
          id: 'ada',
          displayName: 'Ada A',
          username: null,
          photoPath: null,
          photoAlt: null,
          avatarColor: null,
          level: null,
          isAdmin: false,
          hasProfile: true,
        },
      ],
    ]);
    db.rooms = [
      room({ id: 'bowel' }),
      room({
        id: 'shoulder-pain-1a2b',
        name: 'Shoulder pain',
        sortOrder: 1000,
        createdBy: 'ada',
      }),
    ];
    renderPage();
    expect(screen.getByText('Started by Ada A')).toBeInTheDocument();
    expect(screen.queryByText(/Started by a deleted member/)).toBeNull();
  });

  it('keeps the mock’s promise about history and privacy', () => {
    renderPage();
    expect(
      screen.getByText(/to read and to write, with the whole history. Nothing here is public/),
    ).toBeInTheDocument();
  });

  it('draws an open room under its category label', () => {
    db.rooms = [
      room({ id: 'bowel' }),
      room({ id: 'equip', name: 'Equipment & assistive tech', category: 'Kit', sortOrder: 11 }),
    ];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Body' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kit' })).toBeInTheDocument();
    // Life has no open room, so it is not a heading over nothing.
    expect(screen.queryByRole('heading', { name: 'Life' })).toBeNull();
    expect(screen.getByText('Bowel management')).toBeInTheDocument();
  });

  it('opens the room', () => {
    db.rooms = [room({ id: 'bowel' })];
    renderPage();
    expect(screen.getByRole('link', { name: /Bowel management/ })).toHaveAttribute(
      'href',
      '/chat/rooms/bowel',
    );
    // The note that stood here while there was nothing behind the card.
    expect(screen.queryByText(/being built/)).toBeNull();
  });

  // Three zeros read as a room that failed rather than one that has not
  // started, and they would be the first thing a member saw on the day the
  // first room opened.
  it('says a room is empty in words rather than in zeros', () => {
    db.rooms = [room({ id: 'bowel' })];
    db.stats = new Map([
      [
        'bowel',
        { topicCount: 0, questionCount: 0, replyCount: 0, viewCount: 0, lastActivityAt: null },
      ],
    ]);
    renderPage();
    expect(screen.getByText('Nothing has been posted here yet.')).toBeInTheDocument();
    expect(screen.queryByText(/0 posts/)).toBeNull();
  });

  it('counts what is in a room once there is something in it', () => {
    db.rooms = [room({ id: 'bowel' })];
    db.stats = new Map([
      [
        'bowel',
        {
          topicCount: 3,
          questionCount: 1,
          replyCount: 4,
          viewCount: 1200,
          lastActivityAt: new Date(Date.now() - 3 * 3_600_000 - 5_000).toISOString(),
        },
      ],
    ]);
    renderPage();
    // Posts and the questions among them, replies and views, then the last activity
    // (the owner, 2026-11-18). No member count: nobody joins a room since
    // 20260930000000, so there is nobody to count and no Joined chip.
    expect(screen.getByText('3 posts (1 question) · 4 replies · 1,200 views')).toBeInTheDocument();
    expect(screen.getByText('Last activity 3 hours ago')).toBeInTheDocument();
    expect(screen.queryByText('Joined')).toBeNull();
  });

  // Only an administrator is ever given a closed room to draw — the select
  // policy withholds it from everybody else — and without the chip they would
  // have no way to tell which of the twelve a member can actually see.
  it('marks a closed room as one no member can see', () => {
    db.rooms = [room({ id: 'bowel', openedAt: null })];
    renderPage();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('No member can see this room yet.')).toBeInTheDocument();
  });

  it('says nothing about closure on a room that is open', () => {
    db.rooms = [room({ id: 'bowel' })];
    renderPage();
    expect(screen.queryByText(/Closed/)).toBeNull();
  });

  it('shows the rooms without the conversations note under Rooms', async () => {
    db.rooms = [room({ id: 'bowel' })];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    expect(screen.getByText('Bowel management')).toBeInTheDocument();
    expect(screen.queryByText(/are not built yet/)).toBeNull();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
  });

  it('shows the database’s own sentence when the read fails', async () => {
    db.error = 'relation "public.chat_rooms" does not exist';
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Could not load the rooms.')).toBeInTheDocument();
    });
    expect(screen.getByText('relation "public.chat_rooms" does not exist')).toBeInTheDocument();
  });
});

describe('starting something from Chat', () => {
  it('offers a new message to one person, always, at the top', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'New message' })).toHaveAttribute('href', '/chat/new');
  });
});

// The owner, 2026-11-05: "I have too many chats open."
describe('a long list of chats', () => {
  const OLD = '2026-09-10T10:00:00Z';

  it('lists the three latest of each, the rest behind More, unless unread', async () => {
    const names = ['Ann', 'Bo', 'Cy', 'Di', 'Ed'];
    db.authors = new Map(names.map((name) => [name, author({ id: name, displayName: name })]));
    db.threads = [
      ...names.map((name) => thread({ id: name, otherMemberId: name, unread: name === 'Ed' })),
      ...['One', 'Two', 'Three', 'Four'].map((name) =>
        thread({ id: name, kind: 'group', name: `${name} ride`, otherMemberId: null }),
      ),
    ];
    renderPage();
    for (const name of ['Ann', 'Bo', 'Cy', 'Ed', 'One ride', 'Two ride', 'Three ride']) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Di')).toBeNull();
    expect(screen.queryByText('Four ride')).toBeNull();
    // Two sections, each with its own More under it.
    const direct = screen.getByRole('region', { name: 'Direct chats' });
    const groups = screen.getByRole('region', { name: 'Group chats' });
    expect(within(direct).getByText('Ed')).toBeInTheDocument();
    expect(within(direct).queryByText('One ride')).toBeNull();
    expect(within(groups).getByRole('button', { name: /More group chats/ })).toBeInTheDocument();
    const more = within(direct).getByRole('button', { name: /More direct chats/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByText('Di')).toBeInTheDocument();
    expect(screen.queryByText('Four ride')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /More group chats/ }));
    expect(screen.getByText('Four ride')).toBeInTheDocument();
  });

  it('searches them by name, hidden ones too, and what was said, however few', async () => {
    db.authors = new Map([
      ['jan', author({ id: 'jan' })],
      ['kim', author({ id: 'kim', displayName: 'Kim Park', username: 'kimp' })],
    ]);
    db.threads = [
      ...Array.from({ length: 3 }, (_, i) => thread({ id: `t${String(i)}` })),
      thread({ id: 'old', otherMemberId: 'kim', lastAt: OLD, lastMessageAt: OLD }),
    ];
    db.hits = [
      { id: 'm1', threadId: 'old', authorId: 'kim', body: 'Bring the kimp chair', createdAt: OLD },
    ];
    renderPage();
    expect(screen.queryByRole('textbox', { name: 'Ask or post to the club' })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your chats' }), 'kimp');
    expect(
      within(screen.getByRole('region', { name: 'Direct chats' })).getByText('Kim Park'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Jan')).toBeNull();
    expect(screen.queryByRole('button', { name: /More direct chats/ })).toBeNull();
    // The words said, under the conversation's name, opening on that message.
    const said = within(screen.getByRole('region', { name: 'Messages' })).getByRole('link');
    expect(said).toHaveAttribute('href', '/chat/t/old?message=m1');
    expect(said).toHaveTextContent('Kim Park');
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search your chats' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your chats' }), 'nobody');
    expect(screen.getByText('No chat by that name.')).toBeInTheDocument();
  });
});
