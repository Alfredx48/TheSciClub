import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnounceProvider } from '@/lib/announce';
import type * as Blocks from '@/lib/blocks';
import type * as Attachments from '@/lib/chat/attachments';
import type * as Reactions from '@/lib/chat/reactions';
import type * as ReadReceipts from '@/lib/chat/read-receipts';
import type * as Reports from '@/lib/chat/reports';
import type * as SharedPosts from '@/lib/chat/shared-posts';
import type { SharedPost } from '@/lib/chat/shared-posts';
import type * as Threads from '@/lib/chat/threads';
import type { ChatAuthor, ChatMessage, ChatThread } from '@/lib/chat/types';
import ThreadPage from '@/routes/chat/thread-page';

/**
 * The reads are stubbed; `threadTitle` deliberately is not, so what the header
 * calls the conversation is the real function's answer and this file cannot
 * assert its own wording. Its own tests are in src/lib/chat/threads.test.ts.
 *
 * jsdom has no layout, so scrollHeight and clientHeight are both zero and the
 * follow-or-not decision cannot be exercised here. That is what
 * `shouldFollowScroll` is pure and separately tested for.
 */

const db = vi.hoisted(() => ({
  reads: new Map<string, string>(),
  thread: null as ChatThread | null,
  messages: [] as ChatMessage[],
  loading: false,
  error: null as string | null,
  stale: null as string | null,
  hasEarlier: false,
  loadEarlier: vi.fn(() => Promise.resolve()),
  reveal: vi.fn((_id: string) => Promise.resolve(false)),
  authors: new Map<string, ChatAuthor>(),
  isAdmin: false,
  sent: [] as [string, string | null][],
  sendFailure: null as string | null,
  edited: [] as [string, string][],
  editFailure: null as string | null,
  removed: [] as string[],
  reportedMessages: new Set<string>(),
  reports: [] as [string, string][],
  reportFails: null as string | null,
  /** Signed URLs by path, for the group's picture. */
  urls: new Map<string, string>(),
  deletedConversations: [] as string[],
  deleteFailure: null as string | null,
  /** Shared posts' cards by message, and the messages the read answered for. */
  cards: new Map<string, SharedPost>(),
  answered: new Set<string>(),
}));

// A read under the reader's token; its own test is shared-posts.test.ts.
vi.mock('@/lib/chat/shared-posts', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedPosts>()),
  useSharedPosts: () => ({ cards: db.cards, answered: db.answered }),
}));

// The viewer's blocks, and the write: network calls. blockExplainer stays real.
const blocks = vi.hoisted(() => ({
  ids: new Set<string>(),
  reload: vi.fn(),
  block: vi.fn(),
}));
vi.mock('@/lib/blocks', async (importOriginal) => ({
  ...(await importOriginal<typeof Blocks>()),
  useMyBlocks: () => ({
    blocked: [],
    ids: blocks.ids,
    loading: false,
    error: null,
    reload: blocks.reload,
  }),
  blockMember: blocks.block,
}));

vi.mock('@/routes/chat/delete-conversation-api', () => ({
  deleteConversation: (threadId: string) => {
    db.deletedConversations.push(threadId);
    return Promise.resolve(
      db.deleteFailure ? { ok: false, error: db.deleteFailure } : { ok: true },
    );
  },
}));

// Signing is a storage call under the reader's token.
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

// Mutes read and write the club; the button has its own test.
vi.mock('@/lib/chat/mutes', () => ({
  useMute: () => ({ muted: null, busy: false, error: null, toggle: () => undefined }),
  useThreadNotify: () => ({ notify: null, busy: false, error: null, choose: () => undefined }),
}));

vi.mock('@/lib/account', () => ({
  useAccount: () => ({
    status: 'member',
    userId: 'me',
    isAdmin: db.isAdmin,
    displayName: 'Alex',
  }),
}));

// Stubbed, and it has to be: `.env.local` points at the hosted project, so an
// unmocked subscription in a test opens a websocket to production. What the
// hook does is its own concern — the screen's job here is to hand it a refetch.
vi.mock('@/lib/chat/realtime', () => ({
  useRealtimeRows: () => undefined,
}));

vi.mock('@/lib/chat/typing', () => ({
  useTyping: () => ({ typing: [], typed: () => undefined }),
}));

vi.mock('@/lib/chat/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof Threads>()),
  useThreadMessages: () => ({
    thread: db.thread,
    messages: db.messages,
    loading: db.loading,
    error: db.error,
    stale: db.stale,
    hasEarlier: db.hasEarlier,
    loadingEarlier: false,
    earlierError: null,
    loadEarlier: db.loadEarlier,
    reveal: db.reveal,
    reload: () => undefined,
    changed: () => undefined,
    send: (body: string, _attachments: string[] = [], replyTo: string | null = null) => {
      db.sent.push([body, replyTo]);
      return Promise.resolve(db.sendFailure);
    },
    edit: (id: string, body: string) => {
      if (!db.editFailure) db.edited.push([id, body]);
      return Promise.resolve(db.editFailure);
    },
    remove: (id: string) => {
      db.removed.push(id);
      return Promise.resolve(null);
    },
  }),
}));

vi.mock('@/lib/chat/read-receipts', async (importOriginal) => ({
  ...(await importOriginal<typeof ReadReceipts>()),
  useThreadReadReceipts: () => db.reads,
}));

vi.mock('@/lib/chat/authors', () => ({
  useChatAuthors: () => db.authors,
}));

// Stubbed for the same reason as realtime, and the reason is not the socket:
// `.env.local` points at the hosted project, so an unmocked *read* in a test
// talks to production too. reportPreamble is left real — it is the promise the
// sheet makes, and a stub of it would let this file assert its own wording.
vi.mock('@/lib/chat/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof Reports>()),
  useMyReports: () => ({
    postIds: new Set<string>(),
    messageIds: db.reportedMessages,
    loading: false,
    error: null,
    reload: () => undefined,
  }),
  reportMessage: (id: string, note: string) => {
    if (db.reportFails) return Promise.resolve({ ok: false as const, error: db.reportFails });
    db.reports.push([id, note]);
    return Promise.resolve({ ok: true as const, value: null });
  },
}));

const thread = (o: Partial<ChatThread> = {}): ChatThread => ({
  id: 'th1',
  kind: 'direct',
  name: null,
  eventId: null,
  createdAt: '2026-09-18T09:00:00Z',
  lastMessageAt: '2026-09-18T10:00:00Z',
  memberCount: 2,
  otherMemberId: 'jan',
  lastBody: 'Hello.',
  lastAuthorId: 'jan',
  lastAt: '2026-09-18T10:00:00Z',
  lastRemoved: false,
  unread: false,
  photoPath: null,
  lastNotice: null,
  ...o,
});

const message = (o: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  threadId: 'th1',
  authorId: 'jan',
  body: 'Something.',
  createdAt: '2026-09-18T10:00:00Z',
  removedAt: null,
  attachments: [],
  removedByAdmin: false,
  editedAt: null,
  replyTo: null,
  notice: null,
  linkPreview: null,
  sharedPostId: null,
  ...o,
});

const jan: ChatAuthor = {
  id: 'jan',
  displayName: 'Jan',
  username: null,
  photoPath: null,
  photoAlt: null,
  avatarColor: null,
  level: 'T4 complete',
  isAdmin: false,
  hasProfile: true,
};

function RepeatNotification() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      onClick={() => {
        void navigate(`${location.pathname}${location.search}`);
      }}
    >
      Repeat notification
    </button>
  );
}

function renderThread(path = '/chat/t/th1', repeatNotification = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {repeatNotification ? <RepeatNotification /> : null}
      <Routes>
        <Route path="/chat/t/:threadId" element={<ThreadPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  blocks.ids = new Set();
  blocks.reload.mockReset();
  blocks.block.mockReset().mockResolvedValue({ ok: true, value: null });
  db.reads = new Map();
  db.thread = thread();
  db.messages = [];
  db.loading = false;
  db.error = null;
  db.stale = null;
  db.hasEarlier = false;
  db.loadEarlier = vi.fn(() => Promise.resolve());
  db.reveal = vi.fn((_id: string) => Promise.resolve(false));
  db.authors = new Map([['jan', jan]]);
  db.isAdmin = false;
  db.sent = [];
  db.sendFailure = null;
  db.edited = [];
  db.editFailure = null;
  db.removed = [];
  db.reportedMessages = new Set();
  db.reports = [];
  db.reportFails = null;
  db.urls = new Map();
  db.deletedConversations = [];
  db.deleteFailure = null;
  db.cards = new Map();
  db.answered = new Set();
});

describe('a conversation', () => {
  it('is headed by the other member, their level, and a way to their profile', () => {
    renderThread();
    expect(screen.getByRole('heading', { name: 'Jan' })).toBeInTheDocument();
    expect(screen.getByText('T4 complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/peers/jan');
  });

  it('draws what has been said, announced politely as it grows', () => {
    db.messages = [
      message({ id: 'm1', body: 'Which frame?' }),
      message({ id: 'm2', authorId: 'me', body: 'A Top End Force.' }),
    ];
    renderThread();
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Which frame?')).toBeInTheDocument();
    expect(screen.getByText('A Top End Force.')).toBeInTheDocument();
  });

  it('says a conversation is empty rather than leaving a blank screen', () => {
    renderThread();
    expect(screen.getByText(/Nothing has been said yet/)).toBeInTheDocument();
    expect(screen.getByText(/between the two of you/)).toBeInTheDocument();
  });

  it('sends what was typed', async () => {
    renderThread();
    await userEvent.type(screen.getByLabelText('Message Jan'), 'Saturday works.');
    await userEvent.click(screen.getByRole('button', { name: 'Send this message' }));
    await waitFor(() => {
      expect(db.sent).toEqual([['Saturday works.', null]]);
    });
  });

  it('keeps the words when the send is refused, and says why', async () => {
    db.sendFailure = 'new row violates row-level security policy';
    renderThread();
    const box = screen.getByLabelText('Message Jan');
    await userEvent.type(box, 'Saturday works.');
    await userEvent.click(screen.getByRole('button', { name: 'Send this message' }));
    await waitFor(() => {
      expect(screen.getByText(/row-level security/)).toBeInTheDocument();
    });
    expect(box).toHaveValue('Saturday works.');
  });

  // Enter sends here and breaks a line in a topic. Messages are short and Enter
  // is what everybody's hands already do.
  it('sends on Enter', async () => {
    renderThread();
    await userEvent.type(screen.getByLabelText('Message Jan'), 'Yes{Enter}');
    await waitFor(() => {
      expect(db.sent).toEqual([['Yes', null]]);
    });
  });

  it('says which kind of removal happened, and keeps the bubble', () => {
    db.messages = [
      message({ id: 'm1', body: '', removedAt: '2026-09-18T11:00:00Z' }),
      message({
        id: 'm2',
        body: '',
        removedAt: '2026-09-18T11:00:00Z',
        removedByAdmin: true,
      }),
    ];
    renderThread();
    expect(screen.getByText('Removed by its author.')).toBeInTheDocument();
    expect(screen.getByText('Removed by an administrator.')).toBeInTheDocument();
  });

  it('offers Remove on the viewer’s own message and not on anybody else’s', () => {
    db.messages = [message({ id: 'm1' }), message({ id: 'm2', authorId: 'me' })];
    renderThread();
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
  });

  // Unlike a topic. An administrator is in a conversation as a member of it,
  // and one they could reach as an administrator would not be private —
  // moderating that happens by an id somebody hands them, not on a screen.
  it('offers an administrator no more than anybody else here', () => {
    db.isAdmin = true;
    db.messages = [message({ id: 'm1' })];
    renderThread();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('removes the viewer’s own message', async () => {
    db.messages = [message({ id: 'm2', authorId: 'me' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: /^Remove / }));
    await waitFor(() => {
      expect(db.removed).toEqual(['m2']);
    });
  });

  // Their words stay and their name does not — the owner's decision. There is
  // nobody to send to, so the composer goes rather than failing on send.
  it('replaces the composer when the other member has left the club', () => {
    db.thread = thread({ otherMemberId: null });
    db.authors = new Map();
    renderThread();
    expect(screen.getByRole('heading', { name: 'Deleted member' })).toBeInTheDocument();
    expect(screen.getByText(/This member has left the club/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send this message' })).toBeNull();
  });

  it('names a group and says how many are in it', () => {
    db.thread = thread({
      kind: 'group',
      name: 'Saturday ride',
      otherMemberId: null,
      memberCount: 6,
    });
    db.authors = new Map();
    renderThread();
    expect(screen.getByRole('heading', { name: 'Saturday ride' })).toBeInTheDocument();
    // The count is the way in to adding and leaving, so it is a link and not a
    // line of grey text.
    expect(screen.getByRole('link', { name: '6 members' })).toHaveAttribute(
      'href',
      '/chat/t/th1/members',
    );
    // A group is not a pair, so nobody has left it and the composer stays.
    expect(screen.getByRole('button', { name: 'Send this message' })).toBeInTheDocument();
  });

  it('has nothing behind the subtitle of a conversation between two people', () => {
    // A member's level is a fact about them, not a door; their profile is the
    // button already on the right of the header.
    db.thread = thread();
    renderThread();
    expect(screen.queryByRole('link', { name: /members/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });

  it('says a conversation cannot be shown rather than printing nothing', () => {
    db.thread = null;
    renderThread();
    expect(screen.getByText('This conversation cannot be shown.')).toBeInTheDocument();
  });

  it('says why when the first read fails', () => {
    db.thread = null;
    db.error = 'Could not load the conversation.';
    renderThread();
    expect(screen.getByText('This conversation cannot be shown.')).toBeInTheDocument();
    expect(screen.getByText('Could not load the conversation.')).toBeInTheDocument();
  });

  // Bug A (2026-11-03): a failed background read swapped the screen for the
  // error, and the words being typed went with the message box.
  it('keeps the message box and what is typed when a later read fails', async () => {
    db.messages = [message({ id: 'm1', body: 'Which frame?' })];
    const view = renderThread();
    const box = screen.getByLabelText('Message Jan');
    await userEvent.type(box, 'Half a sent');
    db.stale = 'Could not load the conversation.';
    view.rerender(
      <MemoryRouter initialEntries={['/chat/t/th1']}>
        <Routes>
          <Route path="/chat/t/:threadId" element={<ThreadPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Could not refresh this conversation.');
    expect(screen.queryByText('This conversation cannot be shown.')).toBeNull();
    expect(screen.getByLabelText('Message Jan')).toBe(box);
    expect(box).toHaveValue('Half a sent');
    expect(screen.getByText('Which frame?')).toBeInTheDocument();
  });
});

// Like iMessage: a heading for each day, and a sideways drag shows the dates.
describe('dates in a conversation', () => {
  // Noon in the US zones on Friday 18 September, so the days do not move.
  const friday = new Date('2026-09-18T19:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(friday);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('heads each day once, in the reader’s words', () => {
    db.messages = [
      message({ id: 'm1', body: 'Old.', createdAt: '2026-09-01T19:00:00Z' }),
      message({ id: 'm2', body: 'Earlier.', createdAt: '2026-09-16T19:00:00Z' }),
      message({ id: 'm3', body: 'Later.', createdAt: '2026-09-16T20:00:00Z' }),
      message({ id: 'm4', body: 'Last night.', createdAt: '2026-09-17T19:00:00Z' }),
      message({ id: 'm5', body: 'Now.', createdAt: '2026-09-18T18:00:00Z' }),
    ];
    renderThread();
    const log = screen.getByRole('log');
    const headings = ['Tue, Sep 1', 'Wednesday', 'Yesterday', 'Today'];
    // Not counting the dates in a wide screen's margin, which are each message's.
    const heading = (day: string) =>
      within(log)
        .getAllByText(day)
        .filter((found) => !found.closest('[data-testid="side-date"]'));
    for (const day of headings) expect(heading(day)).toHaveLength(1);
    // In order, each above its day's first message.
    const text = log.textContent;
    const at = (words: string) => text.indexOf(words);
    expect(at('Tue, Sep 1')).toBeLessThan(at('Old.'));
    expect(at('Wednesday')).toBeLessThan(at('Earlier.'));
    expect(at('Later.')).toBeLessThan(at('Yesterday'));
    expect(at('Yesterday')).toBeLessThan(at('Last night.'));
    expect(at('Today')).toBeLessThan(at('Now.'));
  });

  it('shows each message’s date while swiped left with a finger, and hides it on release', () => {
    db.messages = [message({ id: 'm1', body: 'Hi.', createdAt: '2026-09-16T19:00:00Z' })];
    renderThread();
    const log = screen.getByRole('log');
    expect(log.style.touchAction).toBe('pan-y');
    const touch = { pointerId: 1, pointerType: 'touch' };
    fireEvent.pointerDown(log, { ...touch, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(log, { ...touch, clientX: 280, clientY: 202 });
    fireEvent.pointerMove(log, { ...touch, clientX: 200, clientY: 204 });
    expect(log.style.transform).toBe('translateX(-64px)');
    const date = screen.getByTestId('swiped-date');
    expect(date).toHaveTextContent(/Wed, Sep 16/);
    expect(date).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerUp(log, { ...touch, clientX: 200, clientY: 204 });
    expect(log.style.transform).toBe('');
    expect(screen.queryByTestId('swiped-date')).toBeNull();
  });

  it('leaves an up-and-down drag, a mouse, a rightward drag and the screen’s edge alone', () => {
    db.messages = [message({ id: 'm1', body: 'Hi.' })];
    renderThread();
    const log = screen.getByRole('log');
    const drag = (pointerType: string, from: [number, number], to: [number, number]) => {
      fireEvent.pointerDown(log, { pointerId: 2, pointerType, clientX: from[0], clientY: from[1] });
      fireEvent.pointerMove(log, { pointerId: 2, pointerType, clientX: to[0], clientY: to[1] });
      const moved = log.style.transform;
      fireEvent.pointerUp(log, { pointerId: 2, pointerType, clientX: to[0], clientY: to[1] });
      return moved;
    };
    expect(drag('touch', [300, 200], [290, 120])).toBe('');
    expect(drag('mouse', [300, 200], [200, 200])).toBe('');
    expect(drag('touch', [200, 200], [300, 200])).toBe('');
    expect(drag('touch', [10, 200], [-90, 200])).toBe('');
  });

  it('does not press what a swipe ends on', async () => {
    db.messages = [message({ id: 'm1', body: 'Hi.' })];
    renderThread();
    const log = screen.getByRole('log');
    const reply = screen.getByRole('button', { name: /Reply to Jan/ });
    const touch = { pointerId: 3, pointerType: 'touch' };
    fireEvent.pointerDown(log, { ...touch, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(log, { ...touch, clientX: 240, clientY: 200 });
    fireEvent.pointerUp(log, { ...touch, clientX: 240, clientY: 200 });
    fireEvent.click(reply);
    expect(screen.queryByText(/Replying to/)).toBeNull();
    // The next press is a press.
    fireEvent.pointerDown(reply, { ...touch, clientX: 240, clientY: 200 });
    fireEvent.click(reply);
    expect(await screen.findByText(/Replying to/)).toBeInTheDocument();
  });
});

describe('a long conversation', () => {
  it('offers Show earlier while older messages exist, and asks for them', async () => {
    db.messages = [message({ id: 'm1' })];
    db.hasEarlier = true;
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }));
    expect(db.loadEarlier).toHaveBeenCalledTimes(1);
  });

  it('offers nothing once the whole conversation is loaded', () => {
    db.messages = [message({ id: 'm1' })];
    renderThread();
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull();
  });

  it('reads back to a linked message older than the newest page', async () => {
    db.messages = [message({ id: 'm2' })];
    db.hasEarlier = true;
    renderThread('/chat/t/th1?message=m1');
    await waitFor(() => {
      expect(db.reveal).toHaveBeenCalledWith('m1');
    });
    expect(db.reveal).toHaveBeenCalledTimes(1);
  });
});

// The owner, 2026-10-06: a conversation opened on a photograph, because the
// photographs loaded after the jump to the bottom and pushed the newest
// message down. jsdom has no layout, so the list is given a height by hand and
// a photograph loading is the ResizeObserver firing.
describe('staying on the newest message while photographs load', () => {
  it('follows the list down as it grows, until the reader scrolls', async () => {
    let resized: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {
          // The test calls `resized` itself.
        }
        disconnect() {
          // Nothing was watched.
        }
      },
    );
    renderThread();
    const box = (await screen.findByRole('log')).parentElement;
    if (!box) throw new Error('The log has no scrolling box around it.');
    let height = 1000;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });

    height = 1400;
    act(() => {
      resized?.();
    });
    expect(box.scrollTop).toBe(1400);

    // The reader scrolls up to read; a photograph landing now leaves them there.
    fireEvent.wheel(box);
    box.scrollTop = 300;
    height = 1800;
    act(() => {
      resized?.();
    });
    expect(box.scrollTop).toBe(300);
    vi.unstubAllGlobals();
  });

  // The owner, 2026-10-26: on a computer a small scroll up was pulled back
  // down, because it stayed within the slack that takes the hold up again.
  it('leaves a small scroll up where it is, and holds again on the way back down', async () => {
    let resized: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {
          // The test calls `resized` itself.
        }
        disconnect() {
          // Nothing was watched.
        }
      },
    );
    renderThread();
    const box = (await screen.findByRole('log')).parentElement;
    if (!box) throw new Error('The log has no scrolling box around it.');
    let height = 1400;
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => height });
    act(() => {
      resized?.();
    });
    expect(box.scrollTop).toBe(1400);
    fireEvent.scroll(box);

    // A notch of the wheel up, well inside the slack.
    fireEvent.wheel(box);
    box.scrollTop = 1360;
    fireEvent.scroll(box);
    expect(box.scrollTop).toBe(1360);
    height = 1800;
    act(() => {
      resized?.();
    });
    expect(box.scrollTop).toBe(1360);

    // Back down to the newest message: held again, so a photograph follows.
    fireEvent.wheel(box);
    box.scrollTop = 1800;
    fireEvent.scroll(box);
    height = 2200;
    act(() => {
      resized?.();
    });
    expect(box.scrollTop).toBe(2200);
    vi.unstubAllGlobals();
  });
});

describe('reporting a message', () => {
  it('offers Report on theirs and Remove on yours, never both', () => {
    db.messages = [message({ id: 'm1' }), message({ id: 'm2', authorId: 'me' })];
    renderThread();
    expect(screen.getByRole('button', { name: /^Report / })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Remove / })).toBeInTheDocument();
  });

  it('offers an administrator the same two, because they are in this conversation as a member', () => {
    // Unlike a topic. The thread screen has never offered an administrator
    // anybody else's Remove — a private thread they could moderate from the
    // inside would not be private — so Report is what they have here too.
    db.isAdmin = true;
    db.messages = [message({ id: 'm1' })];
    renderThread();
    expect(screen.getByRole('button', { name: /^Report / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it("offers nothing on a deleted member's message", () => {
    db.messages = [message({ id: 'm1', authorId: null })];
    renderThread();
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
  });

  it('promises that nothing else in the conversation goes with it', async () => {
    db.messages = [message({ id: 'm1' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    const sheet = screen.getByRole('dialog', { name: 'Report this message' });
    // The sentence a room's post does not get, and the whole point of the
    // feature: an administrator is handed one message and no way back in.
    expect(within(sheet).getByText(/Nothing else in this conversation does/)).toBeInTheDocument();
    expect(db.reports).toEqual([]);
  });

  it('sends the message id and the note, and closes once it has worked', async () => {
    db.messages = [message({ id: 'm1' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    await userEvent.type(screen.getByLabelText('Anything to add'), 'He will not stop.');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(db.reports).toEqual([['m1', 'He will not stop.']]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends without a note, because demanding one is a toll', async () => {
    db.messages = [message({ id: 'm1' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(db.reports).toEqual([['m1', '']]);
    });
  });

  it('says Reported on one already handed over', () => {
    db.messages = [message({ id: 'm1' })];
    db.reportedMessages = new Set(['m1']);
    renderThread();
    expect(screen.getByText('Reported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
  });
});

describe('blocking from a message', () => {
  const group = () =>
    thread({ kind: 'group', name: 'Swimmers', otherMemberId: null, memberCount: 3 });

  it('is offered on somebody else’s message, not yours, not a deleted member’s', () => {
    db.thread = group();
    db.messages = [
      message({ id: 'm1', body: 'From Jan.' }),
      message({ id: 'm2', authorId: 'me', body: 'From me.' }),
      message({ id: 'm3', authorId: null, body: 'From somebody gone.' }),
    ];
    renderThread();
    expect(screen.getAllByRole('button', { name: 'Block Jan' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Block a deleted member/i })).toBeNull();
  });

  it('is not offered, and the message not drawn, once they are blocked', () => {
    db.thread = group();
    blocks.ids = new Set(['jan']);
    db.messages = [message({ id: 'm1', body: 'From Jan.' })];
    renderThread();
    expect(screen.queryByText('From Jan.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Block Jan' })).toBeNull();
  });

  it('asks with the profile’s dialog, blocks, hides them, says so and focuses the heading', async () => {
    const user = userEvent.setup();
    db.thread = group();
    db.messages = [
      message({ id: 'm1', body: 'From Jan.' }),
      message({ id: 'm2', authorId: 'me', body: 'From me.' }),
    ];
    render(
      <AnnounceProvider>
        <MemoryRouter initialEntries={['/chat/t/th1']}>
          <Routes>
            <Route path="/chat/t/:threadId" element={<ThreadPage />} />
          </Routes>
        </MemoryRouter>
      </AnnounceProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Block Jan' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Jan?' });
    expect(dialog).toHaveTextContent('Jan is not told.');
    expect(blocks.block).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Block Jan' }));
    expect(blocks.block).toHaveBeenCalledWith('jan');
    await waitFor(() => {
      expect(screen.queryByText('From Jan.')).toBeNull();
    });
    expect(screen.getByText('From me.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(blocks.reload).toHaveBeenCalled();
    expect(await screen.findByText('You blocked Jan.')).toBeInTheDocument();
  });

  it('leaves for Chat when it is a direct conversation with them, which is hidden whole', async () => {
    const user = userEvent.setup();
    db.messages = [message({ id: 'm1', body: 'From Jan.' })];
    render(
      <MemoryRouter initialEntries={['/chat/t/th1']}>
        <Routes>
          <Route path="/chat/t/:threadId" element={<ThreadPage />} />
          <Route path="/chat" element={<p>The chat list</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Block Jan' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Jan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Block Jan' }));
    expect(await screen.findByText('The chat list')).toBeInTheDocument();
  });

  it('keeps the message and the dialog, with the reason, when the block fails', async () => {
    const user = userEvent.setup();
    blocks.block.mockResolvedValue({ ok: false, error: 'They were not blocked.' });
    db.thread = group();
    db.messages = [message({ id: 'm1', body: 'From Jan.' })];
    renderThread();
    await user.click(screen.getByRole('button', { name: 'Block Jan' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Jan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Block Jan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('They were not blocked.');
    expect(screen.getByText('From Jan.')).toBeInTheDocument();
  });
});

describe('a shared post', () => {
  const card: SharedPost = {
    postId: 'p1',
    topicId: 't1',
    roomId: 'kit',
    roomName: 'Kit',
    topicTitle: 'Which cushion?',
    opening: true,
    authorId: 'jan',
    body: 'Air cells.',
    photoPath: null,
    createdAt: '2026-10-24T10:00:00Z',
  };

  it('is a card under the words, or says it is not available, and nothing more', () => {
    db.messages = [
      message({ id: 'm1', body: 'Look', sharedPostId: 'p1' }),
      message({ id: 'm2', body: '', sharedPostId: 'p2' }),
      message({ id: 'm3', body: '', sharedPostId: 'p3' }),
    ];
    db.cards = new Map([['m1', card]]);
    db.answered = new Set(['m1', 'm2']);
    renderThread();
    expect(screen.getByRole('link', { name: /^Shared post:\s*Kit/ })).toHaveAttribute(
      'href',
      '/chat/rooms/kit/topics/t1',
    );
    expect(screen.getByText("This post isn't available.")).toBeInTheDocument();
    // m3 has not been read yet: not unavailable, only waiting.
    expect(screen.getByText('Shared post…')).toBeInTheDocument();
  });

  it('can be reacted to and reported like any message', () => {
    db.messages = [message({ id: 'm2', body: '', sharedPostId: 'p2' })];
    db.answered = new Set(['m2']);
    renderThread();
    expect(screen.getByRole('button', { name: 'React to this shared post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Report Jan's message" })).toBeInTheDocument();
  });

  it('keeps the post when the sender clears their words', async () => {
    db.messages = [message({ id: 'm2', authorId: 'me', body: 'Look', sharedPostId: 'p1' })];
    db.cards = new Map([['m2', card]]);
    db.answered = new Set(['m2']);
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    expect(screen.getByText('The shared post stays.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Edit your message'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(db.edited).toEqual([['m2', '']]);
    });
  });
});

describe('editing a message', () => {
  it('is offered on the viewer’s own standing message and on nobody else’s', () => {
    db.messages = [message({ id: 'm1' }), message({ id: 'm2', authorId: 'me' })];
    renderThread();
    expect(screen.getAllByRole('button', { name: 'Edit your message' })).toHaveLength(1);
  });

  it('puts the words in the composer, and Send saves them', async () => {
    db.messages = [message({ id: 'm2', authorId: 'me', body: 'Saturday works.' })];
    renderThread();
    await userEvent.type(screen.getByLabelText('Message Jan'), 'Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    const box = screen.getByLabelText('Edit your message');
    expect(box).toHaveValue('Saturday works.');
    expect(box).toHaveFocus();
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send this message' })).toBeNull();
    // Enter saves, as it sends.
    await userEvent.type(box, ' Sunday too.{Enter}');
    await waitFor(() => {
      expect(db.edited).toEqual([['m2', 'Saturday works. Sunday too.']]);
    });
    expect(db.sent).toEqual([]);
    expect(await screen.findByLabelText('Message Jan')).toHaveValue('Half a thought');
    expect(screen.queryByText('Editing message')).toBeNull();
  });

  it('keeps the words and says why when the edit is refused', async () => {
    db.editFailure = 'Your edit was not saved. You can only edit your own message.';
    db.messages = [message({ id: 'm2', authorId: 'me', body: 'Saturday works.' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    await userEvent.type(screen.getByLabelText('Edit your message'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/only edit your own message/);
    expect(screen.getByLabelText('Edit your message')).toHaveValue('Saturday works.!');
  });

  it('is cancelled by Escape, with the draft back and nothing saved', async () => {
    db.messages = [message({ id: 'm2', authorId: 'me', body: 'Saturday works.' })];
    renderThread();
    await userEvent.type(screen.getByLabelText('Message Jan'), 'Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    await userEvent.type(screen.getByLabelText('Edit your message'), ' gone{Escape}');
    expect(screen.getByLabelText('Message Jan')).toHaveValue('Half a thought');
    expect(db.edited).toEqual([]);
  });

  it('hides the reply bar while editing, and Reply ends the edit', async () => {
    db.messages = [message({ id: 'm1' }), message({ id: 'm2', authorId: 'me' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: "Reply to Jan's message" }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit your message' }));
    expect(screen.queryByText(/Replying to/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: "Reply to Jan's message" }));
    expect(screen.queryByText('Editing message')).toBeNull();
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
  });

  it('labels an edited bubble and keeps its edit date available', () => {
    db.messages = [message({ id: 'm1', editedAt: '2026-09-18T10:05:00Z' })];
    renderThread();
    expect(screen.getByText('Edited ·')).toHaveAttribute(
      'title',
      expect.stringContaining('September 18, 2026'),
    );
  });

  it('is not offered on a removed message, nor to an administrator on somebody else’s', () => {
    db.isAdmin = true;
    db.messages = [
      message({ id: 'm1' }),
      message({ id: 'm2', authorId: 'me', body: '', removedAt: '2026-09-18T11:00:00Z' }),
    ];
    renderThread();
    expect(screen.queryByRole('button', { name: 'Edit your message' })).toBeNull();
  });
});

describe('replying to a message', () => {
  it('offers Reply on every standing bubble, named for its author', () => {
    db.messages = [
      message({ id: 'm1' }),
      message({ id: 'm2', authorId: 'me' }),
      message({ id: 'm3', body: '', removedAt: '2026-09-18T11:00:00Z' }),
    ];
    renderThread();
    expect(screen.getByRole('button', { name: "Reply to Jan's message" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply to your message' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reply to/ })).toHaveLength(2);
  });

  it('says who is being answered over the composer, and sends the message with the quote', async () => {
    db.messages = [message({ id: 'm1', body: 'Which frame?' })];
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: "Reply to Jan's message" }));
    expect(screen.getByText(/Replying to/)).toHaveTextContent('Replying to Jan');
    const box = screen.getByLabelText('Message Jan');
    expect(box).toHaveFocus();
    await userEvent.type(box, 'A Top End Force.{Enter}');
    await waitFor(() => {
      expect(db.sent).toEqual([['A Top End Force.', 'm1']]);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Replying to/)).toBeNull();
    });
  });

  it('draws the quote over a reply, and scrolls to the quoted message when tapped', async () => {
    db.messages = [
      message({ id: 'm1', body: 'Which frame do you ride these days, the rigid or the folder?' }),
      message({ id: 'm2', authorId: 'me', body: 'The rigid.', replyTo: 'm1' }),
    ];
    renderThread();
    const quote = screen.getByRole('button', { name: /^Jan\s*Which frame do you ride/ });
    expect(quote).toHaveTextContent('Jan');
    const target = document.getElementById('message-m1');
    if (!target) throw new Error('the quoted message should be on the page');
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    await userEvent.click(quote);
    expect(scrolled).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(target.querySelector('.message-flash')).not.toBeNull();
    });
  });

  it('quotes a removed message as removed, and a photograph as a photograph', () => {
    db.messages = [
      message({ id: 'm1', body: '', removedAt: '2026-09-18T11:00:00Z' }),
      message({ id: 'm2', body: '', attachments: ['threads/th1/a.webp'] }),
      message({ id: 'm3', authorId: 'me', body: 'Sorry to hear it.', replyTo: 'm1' }),
      message({ id: 'm4', authorId: 'me', body: 'Nice.', replyTo: 'm2' }),
    ];
    db.authors = new Map([['jan', jan]]);
    renderThread();
    expect(screen.getByRole('button', { name: /Removed message/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Photograph$/ })).toBeInTheDocument();
  });

  it('heads a quote of the viewer’s own message with You', () => {
    db.messages = [
      message({ id: 'm1', authorId: 'me', body: 'Mine first.' }),
      message({ id: 'm2', authorId: 'me', body: 'And again.', replyTo: 'm1' }),
    ];
    renderThread();
    expect(screen.getByRole('button', { name: /^You\s*Mine first/ })).toHaveTextContent(/^You/);
  });

  it('offers no Reply once the other member has left the club', () => {
    db.thread = thread({ otherMemberId: null });
    db.messages = [message({ id: 'm1', authorId: null })];
    renderThread();
    expect(screen.queryByRole('button', { name: /^Reply to/ })).toBeNull();
  });
});

// A change to a group is recorded, not said (20260930020000): no Reply, no
// Edit, no Remove — the database refuses all three — and Report on somebody
// else's, since a hostile name is done to everybody in the group.
describe('a change to the group', () => {
  const group = () =>
    thread({ kind: 'group', name: 'Tuesday swimmers', otherMemberId: null, memberCount: 3 });

  it('is a line that says who did what, not a bubble', () => {
    db.thread = group();
    db.messages = [message({ id: 'n1', notice: 'renamed', body: 'Tuesday swimmers' })];
    renderThread();
    expect(screen.getByText(/Jan renamed the group to “Tuesday swimmers”/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reply/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('says who was added, and "you" to the member added', () => {
    db.thread = group();
    db.messages = [
      message({ id: 'n1', notice: 'added', body: 'Added Sam Lee to the group', subjectId: 'sam' }),
      message({ id: 'n2', notice: 'added', body: 'Added Me Myself to the group', subjectId: 'me' }),
    ];
    renderThread();
    expect(screen.getByText(/Jan added Sam Lee to the group/)).toBeInTheDocument();
    expect(screen.getByText(/Jan added you to the group/)).toBeInTheDocument();
  });

  it('can be reported when somebody else made it', async () => {
    const user = userEvent.setup();
    db.thread = group();
    db.messages = [message({ id: 'n1', notice: 'renamed', body: 'Something rude' })];
    renderThread();
    await user.click(screen.getByRole('button', { name: 'Report Jan’s change to the group' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(db.reports.map(([id]) => id)).toEqual(['n1']);
    });
  });

  it('says You, and offers nothing, on the reader’s own', () => {
    db.thread = group();
    db.messages = [message({ id: 'n1', authorId: 'me', notice: 'unpictured', body: '' })];
    renderThread();
    expect(screen.getByText(/You took the group’s picture away/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report/ })).toBeNull();
  });

  it('shows the new picture beside the line, and in the header', () => {
    db.urls = new Map([['threads/th1/p.webp', 'https://signed/p']]);
    db.thread = { ...group(), photoPath: 'threads/th1/p.webp' };
    db.messages = [
      message({ id: 'n1', notice: 'pictured', body: '', attachments: ['threads/th1/p.webp'] }),
    ];
    renderThread();
    expect(screen.getByText(/Jan changed the group’s picture/)).toBeInTheDocument();
    const pictures = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    // Once in the header's tile, once beside the line.
    expect(pictures.filter((src) => src === 'https://signed/p')).toHaveLength(2);
  });
});

describe('deleting a conversation with a deleted member', () => {
  function renderWithList() {
    return render(
      <MemoryRouter initialEntries={['/chat/t/th1']}>
        <Routes>
          <Route path="/chat/t/:threadId" element={<ThreadPage />} />
          <Route path="/chat" element={<p>The list of conversations</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('is not offered while the other member is still in the club, nor in a group', () => {
    db.thread = thread();
    const { unmount } = renderThread();
    expect(screen.queryByRole('button', { name: 'Delete this conversation' })).toBeNull();
    unmount();

    db.thread = thread({
      kind: 'group',
      name: 'Saturday ride',
      otherMemberId: null,
      memberCount: 1,
    });
    db.authors = new Map();
    renderThread();
    expect(screen.queryByRole('button', { name: 'Delete this conversation' })).toBeNull();
  });

  it('asks first, and keeping it deletes nothing', async () => {
    db.thread = thread({ otherMemberId: null });
    db.authors = new Map();
    renderThread();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this conversation' }));
    // A screen reader is taken to the question, and everything follows it.
    expect(screen.getByRole('heading', { name: 'Delete this conversation?' })).toHaveFocus();
    expect(screen.getByText(/the other member deleted their account/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('heading', { name: 'Delete this conversation?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete this conversation' })).toHaveFocus();
    expect(db.deletedConversations).toEqual([]);
  });

  it('deletes it and goes back to the list', async () => {
    db.thread = thread({ otherMemberId: null });
    db.authors = new Map();
    renderWithList();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    expect(db.deletedConversations).toEqual(['th1']);
    expect(await screen.findByText('The list of conversations')).toBeInTheDocument();
  });

  it('says why when it could not, and stays', async () => {
    db.thread = thread({ otherMemberId: null });
    db.authors = new Map();
    db.deleteFailure = 'That conversation is not there any more.';
    renderWithList();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That conversation is not there any more.',
    );
    expect(screen.queryByText('The list of conversations')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete conversation' })).toBeEnabled();
  });
});

describe('read receipts', () => {
  it('shows Read on a sent message after the other member reads it', () => {
    db.messages = [message({ id: 'read', authorId: 'me' })];
    db.reads = new Map([
      ['me', '2026-09-18T10:01:00Z'],
      ['jan', '2026-09-18T10:00:00Z'],
    ]);
    renderThread();
    expect(screen.getByText(/· Read$/)).toBeInTheDocument();
  });
  it('shows the number of readers in a group', () => {
    db.thread = thread({ kind: 'group', name: 'Friends', otherMemberId: null, memberCount: 3 });
    db.messages = [message({ id: 'read', authorId: 'me' })];
    db.reads = new Map([
      ['me', '2026-09-18T10:01:00Z'],
      ['jan', '2026-09-18T10:00:00Z'],
      ['bo', '-infinity'],
    ]);
    renderThread();
    expect(screen.getByText(/Read by 1 of 2$/)).toBeInTheDocument();
  });
  it('does not display receipts on incoming messages', () => {
    db.messages = [message({ id: 'incoming' })];
    db.reads = new Map([
      ['me', '2026-09-18T10:01:00Z'],
      ['jan', '2026-09-18T10:00:00Z'],
    ]);
    renderThread();
    expect(screen.queryByText(/ · Read/)).toBeNull();
  });
});

describe('opening on the message a notification was about', () => {
  it('centres that message and lights it up, rather than opening at the bottom', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    db.messages = [
      message({ id: 'm1', body: 'The one the notification was about.' }),
      message({ id: 'm2', body: 'Said since.' }),
    ];
    renderThread('/chat/t/th1?message=m1');
    const target = document.getElementById('message-m1');
    await waitFor(() => {
      expect(target?.querySelector('.message-flash')).not.toBeNull();
    });
    expect(scrolled).toContain('message-m1');
    expect(document.getElementById('message-m2')?.querySelector('.message-flash')).toBeNull();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('re-centres the same message when its notification is pressed again', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    db.messages = [message({ id: 'm1', body: 'The notification message.' })];
    renderThread('/chat/t/th1?message=m1', true);
    await waitFor(() => {
      expect(scrolled).toHaveBeenCalled();
    });
    scrolled.mockClear();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Repeat notification' }));
    await waitFor(() => {
      expect(scrolled.mock.contexts).toContain(document.getElementById('message-m1'));
    });
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('opens at the bottom as before when the message is gone', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    db.messages = [message({ id: 'm2', body: 'Said since.' })];
    renderThread('/chat/t/th1?message=gone');
    expect(scrolled).not.toHaveBeenCalled();
    expect(document.querySelector('.message-flash')).toBeNull();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
});

// The screen stays mounted when only the id changes (report, Bug C).
describe('switching straight to another conversation', () => {
  function OpenOther() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => void navigate('/chat/t/th2')}>
        Open the other conversation
      </button>
    );
  }

  it('leaves the draft and the reply behind', async () => {
    db.messages = [message({ id: 'm1', body: 'Which frame?' })];
    render(
      <MemoryRouter initialEntries={['/chat/t/th1']}>
        <OpenOther />
        <Routes>
          <Route path="/chat/t/:threadId" element={<ThreadPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: "Reply to Jan's message" }));
    await userEvent.type(screen.getByLabelText('Message Jan'), 'Meant for Jan only.');
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();

    db.thread = thread({ id: 'th2' });
    db.messages = [];
    await userEvent.click(screen.getByRole('button', { name: 'Open the other conversation' }));
    expect(screen.getByLabelText('Message Jan')).toHaveValue('');
    expect(screen.queryByText(/Replying to/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send this message' }));
    expect(db.sent).toEqual([]);
  });
});

vi.mock('@/lib/chat/reactions', async (importOriginal) => ({
  ...(await importOriginal<typeof Reactions>()),
  useReactions: () => ({
    rows: [],
    loading: false,
    error: null,
    pending: new Set(),
    failure: null,
    choose: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('@/routes/chat/item-actions', () => ({
  ItemActions: ({ children }: PropsWithChildren) => <>{children}</>,
}));
