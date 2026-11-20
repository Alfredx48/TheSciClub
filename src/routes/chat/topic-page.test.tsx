import { Capacitor } from '@capacitor/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren, useImperativeHandle, useRef } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Blocks from '@/lib/blocks';
import type * as Attachments from '@/lib/chat/attachments';
import type * as Likes from '@/lib/chat/likes';
import type * as Reactions from '@/lib/chat/reactions';
import type * as Reports from '@/lib/chat/reports';
import type * as ChatRooms from '@/lib/chat/rooms';
import type * as Saves from '@/lib/chat/saves';
import type * as Topics from '@/lib/chat/topics';
import type { ChatAuthor, ChatEdit, ChatPost, ChatRoom, ChatTopic } from '@/lib/chat/types';
import type * as RichEditorModule from '@/routes/chat/rich-editor';
import TopicPage from '@/routes/chat/topic-page';

const db = vi.hoisted(() => ({
  rooms: [] as ChatRoom[],
  topic: null as ChatTopic | null,
  posts: [] as ChatPost[],
  authors: new Map<string, ChatAuthor>(),
  isAdmin: false,
  removed: [] as string[],
  removalFiles: [] as string[],
  edited: [] as [string, string][],
  editFails: null as string | null,
  sent: [] as [string, string | null][],
  sendFails: null as string | null,
  reportedPosts: new Set<string>(),
  reports: [] as [string, string][],
  reportFails: null as string | null,
  deleted: [] as string[],
  deleteFails: null as string | null,
  filesDeleted: [] as string[][],
  edits: new Map<string, ChatEdit[]>(),
  editsReloads: 0,
  likes: new Map<string, string[]>(),
  likesAskedFor: [] as string[][],
  liked: [] as string[],
  likeFailure: null as { postId: string; message: string } | null,
  /** The posts whose likes are still being read. */
  likesLoading: new Set<string>(),
  movedTo: null as string | null,
  saved: new Set<string>(),
  saveToggles: [] as [string, string | null][],
  saveFailure: null as { key: string; message: string } | null,
}));

// Saves are private reads and writes; the hook is tested in saves.test.ts.
// jsdom cannot type into TipTap's contenteditable: the reply box's rich
// editor stands in as a text box with the same label, value and keys, so
// these tests keep to what the page does with the words.
vi.mock('@/routes/chat/rich-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof RichEditorModule>()),
  RichEditor: ({
    value,
    onChange,
    label,
    readOnly,
    onKeyDown,
    ref,
  }: Parameters<typeof RichEditorModule.RichEditor>[0]) => {
    const box = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => ({
      focus: () => box.current?.focus(),
      format: () => undefined,
      link: () => undefined,
      insertPhotos: () => undefined,
    }));
    return (
      <textarea
        ref={box}
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event.nativeEvent);
        }}
      />
    );
  },
}));

vi.mock('@/lib/chat/saves', async (importOriginal) => ({
  ...(await importOriginal<typeof Saves>()),
  useTopicSaves: () => ({
    saved: db.saved,
    loading: false,
    error: null,
    failure: db.saveFailure,
    toggle: (topicId: string, postId: string | null) => {
      db.saveToggles.push([topicId, postId]);
    },
  }),
}));

// Likes are a read and a write of the club; the hook has its own test. The
// pure functions stay real.
vi.mock('@/lib/chat/views', () => ({
  usePostViews: (ids: readonly string[]) => ({
    byPost: new Map(ids.map((id) => [id, 0])),
    loading: false,
  }),
}));

vi.mock('@/lib/chat/likes', async (importOriginal) => ({
  ...(await importOriginal<typeof Likes>()),
  usePostLikes: (ids: readonly string[]) => {
    db.likesAskedFor.push([...ids]);
    return {
      byPost: db.likes,
      loading: db.likesLoading.size > 0,
      loadingFor: (id: string) => db.likesLoading.has(id),
      error: null,
      failure: db.likeFailure,
      toggle: (id: string) => {
        db.liked.push(id);
      },
      downvote: () => undefined,
      boost: () => undefined,
      isAdmin: false,
      scoreOf: (id: string) => ({
        score: (db.likes.get(id) ?? []).length,
        myVote: (db.likes.get(id) ?? []).includes('me') ? (1 as const) : (0 as const),
        boost: null,
      }),
      reload: () => undefined,
    };
  },
}));

// chat_edits is administrators' reading; the hook has its own test, and an
// unmocked read here would reach for the network.
vi.mock('@/lib/chat/edits', () => ({
  useEdits: () => ({
    byPost: db.edits,
    byMessage: new Map(),
    loading: false,
    error: null,
    reload: () => {
      db.editsReloads += 1;
    },
  }),
}));

// Storage is the network; record what would have been deleted.
vi.mock('@/lib/chat/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof Attachments>()),
  deleteAttachments: (paths: string[]) => {
    db.filesDeleted.push(paths);
    return Promise.resolve();
  },
}));

// Mutes read and write the club; the button has its own test.
vi.mock('@/lib/chat/mutes', () => ({
  useMute: () => ({ muted: null, busy: false, error: null, toggle: () => undefined }),
}));

vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: 'member', userId: 'me', isAdmin: db.isAdmin, displayName: 'Alex' }),
}));

// Stubbed, and it has to be: `.env.local` points at the hosted project, so an
// unmocked subscription in a test opens a websocket to production. What the
// hook does is its own concern — the screen's job here is to hand it a refetch.
vi.mock('@/lib/chat/realtime', () => ({
  useRealtimeRows: () => undefined,
}));

vi.mock('@/lib/chat/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatRooms>()),
  useChatRooms: () => ({ rooms: db.rooms, loading: false, error: null, reload: () => undefined }),
}));

vi.mock('@/lib/chat/topics', async (importOriginal) => ({
  ...(await importOriginal<typeof Topics>()),
  useTopicPosts: () => ({
    topic: db.topic,
    posts: db.posts,
    lastReadAt: null,
    loading: false,
    error: null,
    reload: () => undefined,
    movedTo: db.movedTo,
  }),
  deleteTopic: (id: string) => {
    if (db.deleteFails) return Promise.resolve({ ok: false as const, error: db.deleteFails });
    db.deleted.push(id);
    return Promise.resolve({ ok: true as const, value: ['rooms/bowel/a.webp'] });
  },
  editTopicTitle: (id: string, title: string) => {
    db.edited.push([`title:${id}`, title]);
    return Promise.resolve({ ok: true as const, value: null });
  },
  deleteMyTopic: (id: string) => {
    db.deleted.push(`mine:${id}`);
    return Promise.resolve({ ok: true as const, value: [] });
  },
  removePost: (id: string) => {
    db.removed.push(id);
    return Promise.resolve({ ok: true as const, value: db.removalFiles });
  },
  editPost: (id: string, body: string) => {
    if (db.editFails) return Promise.resolve({ ok: false as const, error: db.editFails });
    db.edited.push([id, body]);
    return Promise.resolve({ ok: true as const, value: null });
  },
  sendPost: (
    _topicId: string,
    _authorId: string,
    body: string,
    _attachments: string[] = [],
    replyTo: string | null = null,
  ) => {
    if (db.sendFails) return Promise.resolve({ ok: false as const, error: db.sendFails });
    db.sent.push([body, replyTo]);
    return Promise.resolve({ ok: true as const, value: db.posts[0] });
  },
}));

vi.mock('@/lib/chat/authors', () => ({
  useChatAuthors: () => db.authors,
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

// Stubbed for the same reason as realtime, and the reason is not the socket:
// `.env.local` points at the hosted project, so an unmocked *read* in a test
// talks to production too. Phase 6 found two screens doing exactly that.
// reportPreamble is deliberately left real — it is the sentence under test in
// the sheet, and a stub of it would let this file assert its own wording.
vi.mock('@/lib/chat/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof Reports>()),
  useMyReports: () => ({
    postIds: db.reportedPosts,
    messageIds: new Set<string>(),
    loading: false,
    error: null,
    // Reads back what was sent, as the real one does, so Report becomes
    // Reported in the same render that closes the sheet.
    reload: () => {
      for (const [id] of db.reports) db.reportedPosts.add(id);
    },
  }),
  reportPost: (id: string, note: string) => {
    if (db.reportFails) return Promise.resolve({ ok: false as const, error: db.reportFails });
    db.reports.push([id, note]);
    return Promise.resolve({ ok: true as const, value: null });
  },
}));

const author = (o: Partial<ChatAuthor> & { id: string }): ChatAuthor => ({
  displayName: 'Nicole',
  username: null,
  photoPath: null,
  photoAlt: null,
  avatarColor: null,
  level: 'T4',
  isAdmin: false,
  hasProfile: true,
  ...o,
});

const post = (o: Partial<ChatPost> & { id: string }): ChatPost => ({
  topicId: 't',
  authorId: 'nicole',
  body: 'Something useful.',
  createdAt: '2026-09-01T10:00:00Z',
  removedAt: null,
  attachments: [],
  removedByAdmin: false,
  editedAt: null,
  replyTo: null,
  linkPreview: null,
  ...o,
});

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

function renderTopic(path = '/chat/rooms/bowel/topics/t', repeatNotification = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {repeatNotification ? <RepeatNotification /> : null}
      <Routes>
        <Route path="/chat/rooms/:roomId/topics/:topicId" element={<TopicPage />} />
        <Route path="/chat/rooms/:roomId" element={<p>The room</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  blocks.ids = new Set();
  blocks.reload.mockReset();
  blocks.block.mockReset().mockResolvedValue({ ok: true, value: null });
  db.rooms = [
    {
      id: 'bowel',
      name: 'Bowel management',
      description: 'x',
      category: 'Body',
      icon: '◍',
      createdBy: null,
      sortOrder: 1,
      showInHome: true,
      openedAt: '2026-09-01T10:00:00Z',
    },
  ];
  db.topic = {
    id: 't',
    roomId: 'bowel',
    title: 'Travelling with a bowel programme',
    authorId: 'nicole',
    createdAt: '2026-09-01T10:00:00Z',
    lastPostAt: '2026-09-03T10:00:00Z',
    replyCount: 2,
    viewCount: 3,
    unread: false,
    participantIds: ['nicole'],
  };
  db.posts = [post({ id: '1' })];
  db.authors = new Map([['nicole', author({ id: 'nicole' })]]);
  db.isAdmin = false;
  db.removed = [];
  db.removalFiles = [];
  db.edited = [];
  db.editFails = null;
  db.sent = [];
  db.sendFails = null;
  db.reportedPosts = new Set();
  db.reports = [];
  db.reportFails = null;
  db.deleted = [];
  db.deleteFails = null;
  db.filesDeleted = [];
  db.edits = new Map();
  db.editsReloads = 0;
  db.likes = new Map();
  db.likesAskedFor = [];
  db.liked = [];
  db.likeFailure = null;
  db.likesLoading = new Set();
  db.movedTo = null;
  db.saved = new Set();
  db.saveToggles = [];
  db.saveFailure = null;
});

describe('sharing a post', () => {
  it('is offered on every standing post, named for it', () => {
    db.posts = [
      post({ id: '1', body: 'Which cushion do you use?' }),
      post({ id: '2', replyTo: '1', authorId: 'me', body: 'Air cells.' }),
    ];
    renderTopic();
    // Once each: the opening post's shares the topic by its title, and no
    // second Share sits under the title (the owner, 2026-10-29).
    expect(screen.getAllByRole('button', { name: /^Share / }).map((b) => b.ariaLabel)).toEqual([
      'Share “Travelling with a bowel programme”',
      'Share “Air cells.”',
    ]);
  });

  // No member could read what arrived.
  it('is not offered in a closed room', () => {
    db.rooms = db.rooms.map((r) => ({ ...r, openedAt: null }));
    db.isAdmin = true;
    renderTopic();
    expect(screen.queryByRole('button', { name: /^Share / })).toBeNull();
  });
});

describe('blocking from a post', () => {
  beforeEach(() => {
    if (db.topic) db.topic = { ...db.topic, authorId: 'me' };
    db.posts = [
      post({ id: '1', authorId: 'me', body: 'My question, at length.' }),
      post({ id: '2', replyTo: '1', body: 'Nicole answers.' }),
      post({ id: '3', replyTo: '1', authorId: null, body: 'Somebody gone answers.' }),
      post({ id: '4', replyTo: '1', authorId: 'sam', body: 'Sam answers.' }),
    ];
    db.authors = new Map([
      ['nicole', author({ id: 'nicole' })],
      ['sam', author({ id: 'sam', displayName: 'Sam' })],
    ]);
  });

  it('is offered on somebody else’s post, not yours, not a deleted member’s', () => {
    renderTopic();
    expect(screen.getAllByRole('button', { name: /^Block / }).map((b) => b.textContent)).toEqual([
      'Block Nicole',
      'Block Sam',
    ]);
  });

  it('is offered to an administrator too, beside Remove', () => {
    db.isAdmin = true;
    renderTopic();
    expect(screen.getByRole('button', { name: 'Block Nicole' })).toBeInTheDocument();
  });

  it('is not offered, and the post not drawn, once they are blocked', () => {
    blocks.ids = new Set(['nicole']);
    renderTopic();
    expect(screen.queryByText('Nicole answers.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Block Nicole' })).toBeNull();
  });

  it('asks with the profile’s dialog, blocks, hides their posts and focuses the heading', async () => {
    const user = userEvent.setup();
    renderTopic();
    await user.click(screen.getByRole('button', { name: 'Block Nicole' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Nicole?' });
    expect(dialog).toHaveTextContent('Nicole is not told.');
    await user.click(within(dialog).getByRole('button', { name: 'Block Nicole' }));
    expect(blocks.block).toHaveBeenCalledWith('nicole');
    await waitFor(() => {
      expect(screen.queryByText('Nicole answers.')).toBeNull();
    });
    expect(screen.getByText('Sam answers.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Travelling with a bowel programme' }),
    ).toHaveFocus();
    expect(blocks.reload).toHaveBeenCalled();
  });

  it('leaves for the room when it is their topic, which is hidden whole', async () => {
    const user = userEvent.setup();
    if (db.topic) db.topic = { ...db.topic, authorId: 'nicole' };
    db.posts = [post({ id: '1', body: 'Nicole asks, at length.' })];
    renderTopic();
    await user.click(screen.getByRole('button', { name: 'Block Nicole' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Nicole?' });
    await user.click(within(dialog).getByRole('button', { name: 'Block Nicole' }));
    expect(await screen.findByText('The room')).toBeInTheDocument();
  });
});

// A reply or a like notification links to ?post=<id> (20261006000000).
describe('opening on the post a notification was about', () => {
  it('centres that post, lights it up once and gives it focus', async () => {
    const scrolled: [string, ScrollIntoViewOptions | boolean | undefined][] = [];
    // jsdom draws nothing, so it has no scrollIntoView; this one records.
    Element.prototype.scrollIntoView = function (this: Element, options) {
      scrolled.push([this.id, options]);
    };
    db.posts = [post({ id: '1' }), post({ id: '2', replyTo: '1', body: 'The reply' })];
    renderTopic('/chat/rooms/bowel/topics/t?post=2');

    const target = document.getElementById('post-2');
    await waitFor(() => {
      expect(target).toHaveFocus();
    });
    // A frame later: off and on, so a second press lights it again.
    await waitFor(() => {
      expect(target).toHaveClass('message-flash');
    });
    expect(document.getElementById('post-1')).not.toHaveClass('message-flash');
    expect(scrolled).toContainEqual(['post-2', { block: 'center' }]);
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('re-centres the same post when its notification is pressed again', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    db.posts = [post({ id: '1' }), post({ id: '2', replyTo: '1', body: 'The reply' })];
    renderTopic('/chat/rooms/bowel/topics/t?post=2', true);
    await waitFor(() => {
      expect(scrolled).toHaveBeenCalled();
    });
    scrolled.mockClear();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Repeat notification' }));
    await waitFor(() => {
      expect(scrolled.mock.contexts).toContain(document.getElementById('post-2'));
    });
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('opens as it would have when that post has been taken back', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderTopic('/chat/rooms/bowel/topics/t?post=gone');
    expect(await screen.findByText(db.posts[0]?.body ?? '')).toBeInTheDocument();
    expect(document.querySelector('.message-flash')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
});

it('scrolls the focused reply back into view after the native keyboard shrinks the page', async () => {
  const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  const scroll = vi.fn();
  const resize: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private onResize: () => void;
      constructor(onResize: () => void) {
        this.onResize = onResize;
      }
      observe(target: Element) {
        if (target.classList.contains('overflow-y-auto')) resize.push(this.onResize);
      }
      disconnect = vi.fn();
    },
  );
  try {
    Element.prototype.scrollIntoView = scroll;
    renderTopic();
    const box = await screen.findByRole('textbox', { name: 'Reply to this post' });
    box.focus();
    expect(resize).toHaveLength(1);
    resize[0]?.();
    expect(scroll).not.toHaveBeenCalled();
    document.documentElement.dataset.keyboard = '';
    resize[0]?.();
    expect(scroll.mock.contexts).toContain(box);
  } finally {
    delete document.documentElement.dataset.keyboard;
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
    native.mockRestore();
  }
});

describe('likes', () => {
  it('asks for the likes of the standing posts only', () => {
    db.posts = [
      post({ id: '1' }),
      post({ id: '2', body: '', removedAt: '2026-09-02T10:00:00Z' }),
      post({ id: '3', authorId: 'me' }),
    ];
    renderTopic();
    expect(db.likesAskedFor.at(-1)).toEqual(['1', '3']);
  });

  it('offers an upvote on somebody else’s post, named for it, and upvotes on a press', async () => {
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: "Upvote Nicole's post" }));
    expect(db.liked).toEqual(['1']);
  });

  it('offers the arrows and the score on the reader’s own post', async () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
    db.likes = new Map([['2', ['nicole']]]);
    renderTopic();
    const mine = screen.getByRole('button', { name: 'Score 1 on your post. Show who upvoted.' });
    const article = mine.closest('article');
    if (!article) throw new Error('the count is not inside its post');
    await userEvent.click(within(article).getByRole('button', { name: 'Upvote your post' }));
    expect(db.liked).toEqual(['2']);
    expect(screen.getAllByRole('button', { name: /^Upvote / })).toHaveLength(2);
  });

  // The robots, 2026-11-04: a liked post drew "Like" until its likes were read.
  it('never draws an upvote on a post whose votes are still being read', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'jan', replyTo: '1' })];
    db.authors.set('jan', author({ id: 'jan', displayName: 'Jan' }));
    db.likes = new Map([
      ['1', ['me']],
      ['2', ['me']],
    ]);
    // A reply has just arrived: the first post's likes are still known.
    db.likesLoading = new Set(['2']);
    renderTopic();
    expect(screen.queryByRole('button', { name: /^Upvote / })).toBeNull();
    expect(
      screen.getByRole('button', { name: "Upvoted Nicole's post. Press to take it back." }),
    ).toHaveAttribute('aria-pressed', 'true');
    for (const arrow of screen.getAllByRole('button', {
      name: "Your vote on Jan's post is not known",
    })) {
      expect(arrow).toBeDisabled();
    }
  });

  it('upvotes a reply as well as a top-level post', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'jan', replyTo: '1' })];
    db.authors.set('jan', author({ id: 'jan', displayName: 'Jan' }));
    db.likes = new Map([['2', ['me']]]);
    renderTopic();
    expect(
      screen.getByRole('button', { name: "Upvoted Jan's post. Press to take it back." }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('says under the post when a vote did not land', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'jan' })];
    db.authors.set('jan', author({ id: 'jan', displayName: 'Jan' }));
    db.likeFailure = { postId: '2', message: 'Your like was not saved. You cannot like this.' };
    renderTopic();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your like was not saved. You cannot like this.');
    expect(alert.closest('article')).toBe(
      screen.getByRole('button', { name: "Upvote Jan's post" }).closest('article'),
    );
  });
});

describe('saving', () => {
  it('saves the topic from its header', async () => {
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: 'Save this topic' }));
    expect(db.saveToggles).toEqual([['t', null]]);
  });

  it('shows a saved topic as Saved', () => {
    db.saved = new Set(['t']);
    renderTopic();
    expect(
      screen.getByRole('button', { name: 'Saved topic. Press to remove it from Saved.' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves a reply, but offers no second Save on the opening post', async () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'jan', replyTo: '1' })];
    db.authors.set('jan', author({ id: 'jan', displayName: 'Jan' }));
    renderTopic();
    expect(screen.queryByRole('button', { name: "Save Nicole's post" })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: "Save Jan's post" }));
    expect(db.saveToggles).toEqual([['t', '2']]);
  });

  it('says under the post when a save did not land', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'jan' })];
    db.authors.set('jan', author({ id: 'jan', displayName: 'Jan' }));
    db.saved = new Set(['t:2']);
    db.saveFailure = { key: 't:2', message: 'This is still saved.' };
    renderTopic();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This is still saved.');
    expect(alert.closest('article')).toBe(
      screen.getByRole('button', { name: "Remove Jan's post from Saved" }).closest('article'),
    );
  });
});

describe('views on every standing post', () => {
  it('shows a zero view count alongside the score on opening posts and replies', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me', replyTo: '1' })];
    renderTopic();
    const articles = screen.getAllByRole('article');
    for (const article of articles) {
      // Nested articles also include their children; each still has its own count.
      expect(within(article).getAllByText('0 views').length).toBeGreaterThan(0);
      expect(within(article).getAllByText('0').length).toBeGreaterThan(0);
      expect(within(article).getAllByRole('button', { name: /^Upvote / }).length).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('a topic', () => {
  // Views are shown beside the post's •••, not in the header too (2026-10-29).
  it('says how many replies it has, and no views beside who started it', () => {
    renderTopic();
    expect(screen.getByText(/^2 replies · started by/)).toBeInTheDocument();
    expect(screen.queryByText(/views? · started by/)).toBeNull();
  });

  // A count of zero is not drawn: a topic nobody has answered says who
  // started it, not "0 replies".
  it('leaves out a count of zero', () => {
    db.topic = { ...db.topic, replyCount: 0, viewCount: 1 } as ChatTopic;
    renderTopic();
    expect(screen.getByText(/^Started by/)).toBeInTheDocument();
    expect(screen.queryByText(/0 replies/)).toBeNull();
  });

  // The owner, 2026-09-27: a removed post is not drawn at all, and the
  // numbers close up over the gap.
  it('leaves removed posts out and numbers the rest among themselves', () => {
    db.posts = [
      post({ id: '1' }),
      post({ id: '2', body: '', removedAt: '2026-09-02T10:00:00Z' }),
      post({ id: '3', body: '', removedAt: '2026-09-02T10:00:00Z', removedByAdmin: true }),
      post({ id: '4' }),
    ];
    renderTopic();
    // The opening post is the topic's own and unnumbered (2026-10-29); the
    // one answer left is 1/1.
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByText(/Removed by/)).toBeNull();
  });

  describe('deleting it', () => {
    it('is not offered to a member', () => {
      renderTopic();
      expect(screen.queryByRole('button', { name: 'Delete post' })).toBeNull();
    });

    it('asks first, and does nothing when the administrator says no', async () => {
      db.isAdmin = true;
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));
      expect(confirm).toHaveBeenCalledOnce();
      expect(db.deleted).toEqual([]);
      confirm.mockRestore();
    });

    it('deletes it, removes its photographs, and goes back to the room', async () => {
      db.isAdmin = true;
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));
      expect(await screen.findByText('The room')).toBeInTheDocument();
      expect(db.deleted).toEqual(['t']);
      expect(db.filesDeleted).toEqual([['rooms/bowel/a.webp']]);
      confirm.mockRestore();
    });

    it('says so when it fails, and stays', async () => {
      db.isAdmin = true;
      db.deleteFails = 'The post was not deleted. You cannot do that here.';
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The post was not deleted.');
      expect(screen.queryByText('The room')).toBeNull();
      confirm.mockRestore();
    });
  });

  it('names a member who has left the club without linking to them', () => {
    // An answer: the opening post is drawn under the header, which names its starter.
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: null })];
    renderTopic();
    const article = screen.getByText('Deleted member').closest('article');
    if (!article) throw new Error('the post is not drawn as an article');
    expect(within(article).queryByRole('link')).toBeNull();
  });

  // The first post's toolbar writes a small Markdown; the page shows it
  // formatted, and a typed tag as text.
  it('shows a post formatted, and a typed tag as text', () => {
    db.posts = [post({ id: '1', body: '**Bring water**\n- Gloves\n<b>not bold</b>' })];
    renderTopic();
    expect(screen.getByText('Bring water').tagName).toBe('STRONG');
    expect(screen.getByText('Gloves').tagName).toBe('LI');
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeInTheDocument();
  });

  it('links to a member who is still in the directory, and not to one who is not', () => {
    db.authors = new Map([
      ['nicole', author({ id: 'nicole' })],
      ['hidden', author({ id: 'hidden', displayName: 'Jake', hasProfile: false })],
    ]);
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'hidden' })];
    renderTopic();
    // On her post, and in the header as the one who started it.
    const nicole = screen.getAllByRole('link', { name: 'Nicole' });
    expect(nicole.length).toBeGreaterThan(0);
    for (const link of nicole) expect(link).toHaveAttribute('href', '/peers/nicole');
    // Named all the same — hiding from the deck is not unwriting a post.
    expect(screen.getByText('Jake')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Jake' })).toBeNull();
  });

  // A question with no details hides its opening post, and with it the post's
  // own picture and linked name; the header is then the only place the asker
  // appears.
  it('shows who asked a question, with their picture and a link, when the opening post is hidden', () => {
    db.posts = [post({ id: '1', body: 'Travelling with a bowel programme' })];
    renderTopic();
    const link = screen.getByRole('link', { name: 'Nicole' });
    expect(link).toHaveAttribute('href', '/peers/nicole');
    const row = link.closest('p');
    expect(row?.textContent).toMatch(/started by Nicole/i);
    expect(row?.querySelector('[aria-hidden="true"]')).toHaveTextContent(/\S/);
  });

  it('names a starter with no profile without linking them', () => {
    db.authors = new Map([['nicole', author({ id: 'nicole', hasProfile: false })]]);
    db.posts = [post({ id: '1', body: 'Travelling with a bowel programme' })];
    renderTopic();
    expect(screen.queryByRole('link', { name: 'Nicole' })).toBeNull();
    expect(screen.getByText(/started by Nicole/i)).toBeInTheDocument();
  });

  // The owner, 2026-10-29: a topic posted with only a title offered no Edit.
  it('edits the title of the viewer’s own topic that has only its title', async () => {
    if (db.topic) db.topic = { ...db.topic, authorId: 'me' };
    db.posts = [post({ id: '1', authorId: 'me', body: 'Travelling with a bowel programme' })];
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
    const box = await screen.findByLabelText('Edit your post');
    expect(box).toHaveValue('Travelling with a bowel programme');
    await userEvent.clear(box);
    await userEvent.type(box, 'Flying with a bowel programme');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(db.edited).toEqual([['title:t', 'Flying with a bowel programme']]);
    });
  });

  // The owner, 2026-10-29: once somebody has replied, a post's words stay.
  it('only adds to the viewer’s own post once somebody else has replied', async () => {
    db.posts = [
      post({ id: '1', authorId: 'me', body: 'My first words.' }),
      post({ id: '2', body: 'An answer.' }),
    ];
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
    const box = await screen.findByLabelText('Edit your post');
    expect(box).toHaveValue('My first words.');
    expect(screen.getByText(/you can add words or photographs but not change/)).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'Different words.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Put the words back as they were/)).toBeInTheDocument();
    expect(db.edited).toEqual([]);
    await userEvent.clear(box);
    await userEvent.type(box, 'My first words. And more.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(db.edited).toEqual([['1', 'My first words. And more.']]);
    });
  });

  // The owner, 2026-10-29: removing an unanswered topic's opening post left
  // its title standing.
  it('offers Delete post on the viewer’s own topic while nobody else has posted', async () => {
    if (db.topic) db.topic = { ...db.topic, authorId: 'me' };
    db.posts = [post({ id: '1', authorId: 'me', body: 'Alone here.' })];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    expect(await screen.findByText('The room')).toBeInTheDocument();
    expect(db.deleted).toEqual(['mine:t']);
    expect(db.removed).toEqual([]);
    confirm.mockRestore();
  });

  it('offers no Remove on the viewer’s own post once somebody else has replied', () => {
    if (db.topic) db.topic = { ...db.topic, authorId: 'me' };
    db.posts = [
      post({ id: '1', authorId: 'me', body: 'Asked.' }),
      post({ id: '2', body: 'Answered.' }),
      post({ id: '3', authorId: 'me', body: 'Thanks.' }),
    ];
    renderTopic();
    // Only the unanswered reply of their own can go.
    expect(screen.getAllByRole('button', { name: 'Remove your post' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Delete post' })).toBeNull();
  });

  // The owner, 2026-10-29: details added to a topic read as a reply under it.
  it('draws the opening post under the title, unnumbered and without a name of its own', () => {
    db.posts = [post({ id: '1', body: 'Which cushion do you use?' })];
    renderTopic();
    const article = screen.getByText('Which cushion do you use?').closest('article');
    if (!article) throw new Error('no article');
    expect(within(article).getByRole('heading', { name: 'The post' })).toBeInTheDocument();
    expect(within(article).queryByText(/^\d+\/\d+$/)).toBeNull();
    expect(within(article).queryByRole('link', { name: 'Nicole' })).toBeNull();
    expect(screen.getByText('No answers yet. Yours can be the first.')).toBeInTheDocument();
  });

  it('offers Remove on the viewer’s own post and on nobody else’s', () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
    renderTopic();
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
    // Named for the post, so a list of twenty is not twenty "Remove"s.
    expect(screen.getByRole('button', { name: 'Remove your post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Report Nicole's post" })).toBeInTheDocument();
  });

  describe('editing', () => {
    it('is offered on the viewer’s own standing post and on nobody else’s', () => {
      db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
      renderTopic();
      expect(screen.getAllByRole('button', { name: 'Edit your post' })).toHaveLength(1);
    });

    // An administrator removes; rewriting a member's words in their name is
    // not moderation, and chat_edit_post refuses them too.
    it('is not offered to an administrator on somebody else’s post', () => {
      db.isAdmin = true;
      db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
      renderTopic();
      expect(screen.getAllByRole('button', { name: 'Edit your post' })).toHaveLength(1);
    });

    it('is not offered in a closed room', () => {
      db.rooms = db.rooms.map((r) => ({ ...r, openedAt: null }));
      db.posts = [post({ id: '2', authorId: 'me' })];
      renderTopic();
      expect(screen.queryByRole('button', { name: 'Edit your post' })).toBeNull();
    });

    it('puts the words in the reply composer, and Send saves them', async () => {
      db.posts = [post({ id: '2', authorId: 'me', body: 'First draft.' })];
      renderTopic();
      await userEvent.type(await screen.findByLabelText('Reply to this post'), 'Half a reply');
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      const box = await screen.findByLabelText('Edit your post');
      expect(box).toHaveValue('First draft.');
      expect(box).toHaveFocus();
      expect(screen.getByText('Editing post')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Post this reply' })).toBeNull();
      await userEvent.type(box, ' Second thoughts.');
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => {
        expect(db.edited).toEqual([['2', 'First draft. Second thoughts.']]);
      });
      // No new reply, and the unsent one is back.
      expect(db.sent).toEqual([]);
      expect(await screen.findByLabelText('Reply to this post')).toHaveValue('Half a reply');
      expect(screen.queryByText('Editing post')).toBeNull();
    });

    it('keeps the words and says why when the edit is refused', async () => {
      db.editFails = 'Your edit was not saved. You can only edit your own post.';
      db.posts = [post({ id: '2', authorId: 'me', body: 'First draft.' })];
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      const box = await screen.findByLabelText('Edit your post');
      await userEvent.type(box, ' More.');
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/You can only edit your own post/);
      expect(box).toHaveValue('First draft. More.');
    });

    it('is cancelled by the button and by Escape, with nothing saved', async () => {
      db.posts = [post({ id: '2', authorId: 'me', body: 'First draft.' })];
      renderTopic();
      await userEvent.type(await screen.findByLabelText('Reply to this post'), 'Half a reply');
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
      expect(await screen.findByLabelText('Reply to this post')).toHaveValue('Half a reply');
      expect(screen.getByText('First draft.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      await userEvent.type(await screen.findByLabelText('Edit your post'), ' gone{Escape}');
      expect(await screen.findByLabelText('Reply to this post')).toHaveValue('Half a reply');
      expect(db.edited).toEqual([]);
    });

    it('ends when the post is removed', async () => {
      db.posts = [post({ id: '2', authorId: 'me', body: 'First draft.' })];
      renderTopic();
      await userEvent.type(await screen.findByLabelText('Reply to this post'), 'Half a reply');
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      // What the next read brings, drawn on the re-render Remove causes.
      db.posts = [
        post({ id: '2', authorId: 'me', body: '', removedAt: '2026-09-01T12:00:00Z' }),
        post({ id: '3' }),
      ];
      await userEvent.click(screen.getByRole('button', { name: 'Remove your post' }));
      await waitFor(() => {
        expect(screen.queryByText('Editing post')).toBeNull();
      });
      expect(await screen.findByLabelText('Reply to this post')).toHaveValue('Half a reply');
    });

    it('says Edited, with the time, under an edited post', () => {
      db.posts = [post({ id: '1', editedAt: '2026-09-01T11:30:00Z' })];
      renderTopic();
      expect(screen.getByText(/^Edited · /)).toBeInTheDocument();
    });

    // What an edited post used to say, for the one reader who may have to
    // act on it. The hook hands a member nothing, so the disclosure is
    // simply absent for them; here the map says what came back.
    it('shows an administrator every earlier version under a disclosure', async () => {
      db.isAdmin = true;
      db.posts = [post({ id: '1', body: 'Third draft.', editedAt: '2026-09-01T11:30:00Z' })];
      db.edits = new Map([
        [
          '1',
          [
            {
              id: 'e1',
              postId: '1',
              messageId: null,
              body: 'First draft.',
              attachments: [],
              editedBy: 'nicole',
              replacedAt: '2026-09-01T11:00:00Z',
            },
            {
              id: 'e2',
              postId: '1',
              messageId: null,
              body: 'Second draft.',
              attachments: [],
              editedBy: 'nicole',
              replacedAt: '2026-09-01T11:30:00Z',
            },
          ],
        ],
      ]);
      renderTopic();
      const disclosure = screen.getByText('Earlier versions');
      expect(disclosure.closest('details')).not.toHaveAttribute('open');
      await userEvent.click(disclosure);
      const details = disclosure.closest('details');
      expect(details).toHaveAttribute('open');
      if (!(details instanceof HTMLElement)) throw new Error('the disclosure should be a details');
      const items = within(details).getAllByRole('listitem');
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('First draft.'),
        expect.stringContaining('Second draft.'),
      ]);
      expect(screen.getAllByText(/^Replaced /)).toHaveLength(2);
    });

    it('draws no disclosure for a post with no earlier versions', () => {
      db.isAdmin = true;
      db.posts = [post({ id: '1' })];
      renderTopic();
      expect(screen.queryByText('Earlier versions')).toBeNull();
    });

    it('re-reads the earlier versions once its own edit lands', async () => {
      db.isAdmin = true;
      db.posts = [post({ id: '2', authorId: 'me', body: 'First draft.' })];
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: 'Edit your post' }));
      await userEvent.type(await screen.findByLabelText('Edit your post'), ' More.');
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => {
        expect(db.editsReloads).toBe(1);
      });
    });
  });

  describe('replies under a post', () => {
    const jake = author({ id: 'jake', displayName: 'Jake' });
    beforeEach(() => {
      db.authors = new Map([
        ['nicole', author({ id: 'nicole' })],
        ['jake', jake],
      ]);
      db.posts = [
        post({ id: 'q', createdAt: '2026-09-01T10:00:00Z' }),
        post({ id: 'r1', authorId: 'jake', replyTo: 'q', createdAt: '2026-09-01T12:00:00Z' }),
        post({ id: 'a1', authorId: 'me', createdAt: '2026-09-01T11:00:00Z' }),
      ];
    });

    it('draws a reply inside its post, unnumbered, and numbers the top level only', () => {
      renderTopic();
      const articles = screen.getAllByRole('article');
      // Three articles: the question with its reply inside it, and the answer.
      // The question is the topic's own post, unnumbered; the answer is 1/1.
      expect(articles).toHaveLength(3);
      const question = articles[0];
      if (!question) throw new Error('no question');
      expect(within(question).queryByText(/^\d+\/\d+$/)).toBeNull();
      expect(within(question).getByRole('article')).toBeInTheDocument();
      expect(screen.getByText('1/1')).toBeInTheDocument();
      expect(screen.queryByText(/\/2$/)).toBeNull();
    });

    it('offers Reply on every standing post, named for its author', () => {
      renderTopic();
      expect(screen.getByRole('button', { name: "Reply to Nicole's post" })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: "Reply to Jake's post" })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reply to your post' })).toBeInTheDocument();
    });

    // The owner, 2026-11-19: "the reply box should be right under the comment
    // to which they said reply to". The box at the bottom waits, hidden.
    it('opens the reply box under the post, and files the reply there', async () => {
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: "Reply to Nicole's post" }));
      expect(await screen.findByText(/Replying to/)).toHaveTextContent('Replying to Nicole');
      const box = await screen.findByLabelText('Write your reply');
      const question = screen.getAllByRole('article')[0];
      if (!question) throw new Error('no question');
      expect(question).toContainElement(box);
      expect(box).toHaveFocus();
      expect(screen.getByLabelText('Reply to this post')).not.toBeVisible();
      await userEvent.type(box, 'Under the question.');
      await userEvent.click(screen.getByRole('button', { name: 'Post this reply' }));
      await waitFor(() => {
        expect(db.sent).toEqual([['Under the question.', 'q']]);
      });
      await waitFor(() => {
        expect(screen.queryByText(/Replying to/)).toBeNull();
      });
      expect(screen.getByLabelText('Reply to this post')).toBeVisible();
    });

    // Reply on a reply names and answers that particular reply.
    it('files a reply to a reply under that specific reply', async () => {
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: "Reply to Jake's post" }));
      expect(await screen.findByText(/Replying to/)).toHaveTextContent('Replying to Jake');
      const box = await screen.findByLabelText('Write your reply');
      const reply = screen
        .getAllByRole('article')
        .find(
          (a) =>
            within(a).queryByRole('button', { name: "Reply to Jake's post" }) &&
            !within(a).queryByRole('button', { name: "Reply to Nicole's post" }),
        );
      expect(reply).toContainElement(box);
      await userEvent.type(box, 'Under this reply.');
      await userEvent.click(screen.getByRole('button', { name: 'Post this reply' }));
      await waitFor(() => {
        expect(db.sent).toEqual([['Under this reply.', 'r1']]);
      });
    });

    it('turns back into an ordinary post when the bar is closed', async () => {
      renderTopic();
      await userEvent.click(screen.getByRole('button', { name: "Reply to Nicole's post" }));
      await userEvent.click(screen.getByRole('button', { name: 'Stop replying' }));
      expect(screen.queryByText(/Replying to/)).toBeNull();
      await userEvent.type(await screen.findByLabelText('Reply to this post'), 'On its own.');
      await userEvent.click(screen.getByRole('button', { name: 'Post this reply' }));
      await waitFor(() => {
        expect(db.sent).toEqual([['On its own.', null]]);
      });
    });

    // The database nulls replyTo when the parent is removed; and if the read
    // is older than that, the parent is simply not drawn. Either way the
    // reply stands on its own, and nothing says "reply to a removed post".
    it('stands a reply on its own once its post is removed', () => {
      db.posts = [
        post({
          id: 'q',
          body: '',
          removedAt: '2026-09-02T10:00:00Z',
          createdAt: '2026-09-01T10:00:00Z',
        }),
        post({ id: 'r1', authorId: 'jake', replyTo: 'q', createdAt: '2026-09-01T12:00:00Z' }),
      ];
      renderTopic();
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.getByText('1/1')).toBeInTheDocument();
      expect(screen.queryByText(/removed/i)).toBeNull();
    });

    // The owner, 2026-09-29: for the day a thread of replies gets long.
    const folded = () => [
      post({ id: 'q', body: 'The question.', createdAt: '2026-09-01T10:00:00Z' }),
      post({
        id: 'r1',
        authorId: 'jake',
        replyTo: 'q',
        body: 'A reply under the question.',
        createdAt: '2026-09-01T12:00:00Z',
      }),
      post({ id: 'a1', authorId: 'me', body: 'An answer.', createdAt: '2026-09-01T11:00:00Z' }),
    ];

    it('hides the replies under a post and shows them again, naming the count and the post', async () => {
      db.posts = folded();
      renderTopic();
      expect(screen.getByText('A reply under the question.')).toBeVisible();
      const hide = screen.getByRole('button', { name: "Hide 1 reply to Nicole's post" });
      expect(hide).toHaveAttribute('aria-expanded', 'true');
      await userEvent.click(hide);
      const show = screen.getByRole('button', { name: "Show 1 reply to Nicole's post" });
      expect(show).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('A reply under the question.')).not.toBeVisible();
      await userEvent.click(show);
      expect(screen.getByText('A reply under the question.')).toBeVisible();
    });

    it('collapses a reply conversation independently of its siblings and parent', async () => {
      db.posts = [
        ...folded(),
        post({ id: 'deep', authorId: 'me', replyTo: 'r1', body: 'Nested conversation.' }),
        post({ id: 'sibling', replyTo: 'q', body: 'A sibling conversation.' }),
      ];
      renderTopic();
      const parent = document.getElementById('post-r1');
      expect(parent).toContainElement(document.getElementById('post-deep'));
      await userEvent.click(screen.getByRole('button', { name: "Hide 1 reply to Jake's post" }));
      expect(screen.getByText('Nested conversation.')).not.toBeVisible();
      expect(screen.getByText('A reply under the question.')).toBeVisible();
      expect(screen.getByText('A sibling conversation.')).toBeVisible();
      await userEvent.click(
        screen.getByRole('button', { name: "Hide 3 replies to Nicole's post" }),
      );
      expect(screen.getByText('A sibling conversation.')).not.toBeVisible();
      await userEvent.click(
        screen.getByRole('button', { name: "Show 3 replies to Nicole's post" }),
      );
      expect(screen.getByText('A sibling conversation.')).toBeVisible();
      expect(screen.getByText('Nested conversation.')).not.toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: "Show 1 reply to Jake's post" }));
      expect(screen.getByText('Nested conversation.')).toBeVisible();
    });

    it('draws no hide control on a post with no replies', () => {
      db.posts = folded();
      renderTopic();
      expect(screen.getAllByRole('button', { name: /^Hide / })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /^(Hide|Show) .* to your post$/ })).toBeNull();
    });

    // A reply you have just written under a folded post must not land where
    // you cannot see it.
    it('shows the replies again once their number changes', async () => {
      db.posts = folded();
      const { rerender } = renderTopic();
      await userEvent.click(screen.getByRole('button', { name: "Hide 1 reply to Nicole's post" }));
      expect(screen.getByText('A reply under the question.')).not.toBeVisible();
      db.posts = [
        ...folded(),
        post({
          id: 'r2',
          authorId: 'me',
          replyTo: 'q',
          body: 'Mine, just now.',
          createdAt: '2026-09-01T13:00:00Z',
        }),
      ];
      rerender(
        <MemoryRouter initialEntries={['/chat/rooms/bowel/topics/t']}>
          <Routes>
            <Route path="/chat/rooms/:roomId/topics/:topicId" element={<TopicPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByText('Mine, just now.')).toBeVisible();
      expect(screen.getByText('A reply under the question.')).toBeVisible();
      expect(
        screen.getByRole('button', { name: "Hide 2 replies to Nicole's post" }),
      ).toBeInTheDocument();
    });

    it('offers no Reply in a closed room', () => {
      db.rooms = db.rooms.map((r) => ({ ...r, openedAt: null }));
      renderTopic();
      expect(screen.queryByRole('button', { name: /^Reply to/ })).toBeNull();
    });
  });

  it('offers Remove on every post to an administrator', async () => {
    db.isAdmin = true;
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
    renderTopic();
    const buttons = screen.getAllByRole('button', { name: /^Remove / });
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    if (!first) throw new Error('no Remove button to press');
    await userEvent.click(first);
    await waitFor(() => {
      expect(db.removed).toEqual(['1']);
    });
  });

  // 20261018020000: a post's row could name anybody's photograph, and an
  // administrator may delete any file in the bucket. So the files deleted are
  // the ones the removal returns (its author's own), never the row's list.
  it('deletes only the files the removal returns, not what the post named', async () => {
    db.isAdmin = true;
    db.posts = [
      post({ id: '1', attachments: ['rooms/bowel/somebody-elses.webp', 'rooms/bowel/own.webp'] }),
    ];
    db.removalFiles = ['rooms/bowel/own.webp'];
    renderTopic();
    const [remove] = screen.getAllByRole('button', { name: /^Remove / });
    if (!remove) throw new Error('no Remove button to press');
    await userEvent.click(remove);
    await waitFor(() => {
      expect(db.filesDeleted).toEqual([['rooms/bowel/own.webp']]);
    });
  });

  it('offers no Remove on a post that is already removed', () => {
    db.isAdmin = true;
    db.posts = [post({ id: '1', body: '', removedAt: '2026-09-02T10:00:00Z' })];
    renderTopic();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  // Enter is a paragraph break here and not a send. A member dictating a post
  // will pause, and a send bound to Enter would publish the first sentence.
  it('breaks a line on Enter rather than posting', async () => {
    renderTopic();
    const box = await screen.findByLabelText('Reply to this post');
    await userEvent.type(box, 'First line{Enter}second line');
    expect(db.sent).toEqual([]);
    expect(box).toHaveValue('First line\nsecond line');
  });

  it('posts what was typed when the button is pressed', async () => {
    renderTopic();
    await userEvent.type(
      await screen.findByLabelText('Reply to this post'),
      'That worked for me too.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Post this reply' }));
    await waitFor(() => {
      expect(db.sent).toEqual([['That worked for me too.', null]]);
    });
  });

  // The one thing this control must never do, especially to somebody who
  // dictated four paragraphs into it.
  it('keeps the draft when the post is refused, and says what happened', async () => {
    db.sendFails = 'new row violates row-level security policy';
    renderTopic();
    const box = await screen.findByLabelText('Reply to this post');
    await userEvent.type(box, 'Four paragraphs of this.');
    await userEvent.click(screen.getByRole('button', { name: 'Post this reply' }));
    await waitFor(() => {
      expect(screen.getByText(/row-level security policy/)).toBeInTheDocument();
    });
    expect(box).toHaveValue('Four paragraphs of this.');
  });

  // Since 20260930000000 any member writes in an open room: the composer is
  // there for somebody who has joined nothing, and there is no Join.
  it('offers the composer to somebody who has joined nothing, and no Join', async () => {
    renderTopic();
    expect(await screen.findByLabelText('Reply to this post')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull();
  });

  it('offers a member no composer in a closed room', () => {
    db.rooms = db.rooms.map((r) => ({ ...r, openedAt: null }));
    renderTopic();
    expect(screen.queryByLabelText('Reply to this post')).toBeNull();
    expect(screen.getByText('This room is closed. No member can see it yet.')).toBeInTheDocument();
  });

  it('tells an administrator that nobody can see a topic in a closed room', () => {
    db.isAdmin = true;
    db.rooms = db.rooms.map((r) => ({ ...r, openedAt: null }));
    renderTopic();
    expect(screen.getByText(/No member can see this post yet/)).toBeInTheDocument();
  });
});

describe('reporting a post', () => {
  it("offers Report on somebody else's post and Remove on your own", () => {
    db.posts = [post({ id: '1' }), post({ id: '2', authorId: 'me' })];
    renderTopic();
    // Two posts and two controls between them, not four: the reader can take
    // back what they wrote, and hand over what somebody else did, and neither
    // post offers both.
    expect(screen.getAllByRole('button', { name: /^Report / })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
  });

  it('offers an administrator Remove instead, not a complaint to themselves', () => {
    db.isAdmin = true;
    renderTopic();
    expect(screen.getByRole('button', { name: /^Remove / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
  });

  it("offers nothing on a deleted member's post", () => {
    // A report names who wrote it, and they have already left the club.
    db.posts = [post({ id: '1', authorId: null })];
    renderTopic();
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('says what will be disclosed before anything is sent', async () => {
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    const sheet = screen.getByRole('dialog', { name: 'Report this post' });
    // The promise, and the fact that it has not happened yet.
    expect(
      within(sheet).getByText(/go to the club's administrators, with your name/),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/The person is not told/)).toBeInTheDocument();
    expect(db.reports).toEqual([]);
  });

  it('sends the note with the report, and can be backed out of', async () => {
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(db.reports).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    await userEvent.type(screen.getByLabelText('Anything to add'), 'Selling supplements.');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(db.reports).toEqual([['1', 'Selling supplements.']]);
    });
    // The sheet goes once it has worked, and not before.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('puts focus on Reported once the report has gone, and back on Report after Cancel', async () => {
    const user = userEvent.setup();
    renderTopic();
    await user.click(screen.getByRole('button', { name: /^Report / }));
    expect(screen.getByRole('heading', { name: 'Report this post' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /^Report / })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /^Report / }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(screen.getByText('Reported')).toHaveFocus();
    });
  });

  it('keeps the sheet and the words when the report is refused', async () => {
    db.reportFails = 'new row violates row-level security policy';
    renderTopic();
    await userEvent.click(screen.getByRole('button', { name: /^Report / }));
    const note = screen.getByLabelText('Anything to add');
    await userEvent.type(note, 'What happened.');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => {
      expect(screen.getByText(/row-level security policy/)).toBeInTheDocument();
    });
    expect(note).toHaveValue('What happened.');
    expect(screen.getByRole('dialog', { name: 'Report this post' })).toBeInTheDocument();
  });

  it('says Reported, inertly, on something already handed over', () => {
    db.reportedPosts = new Set(['1']);
    renderTopic();
    expect(screen.getByText('Reported')).toBeInTheDocument();
    // Not a disabled button: a disabled control reads out as one and invites a
    // second try.
    expect(screen.queryByRole('button', { name: /^Report / })).toBeNull();
  });
});

describe('a topic moved to another room', () => {
  it('follows it there, keeping the post the link was about', async () => {
    db.topic = null;
    db.movedTo = 'general';
    render(
      <MemoryRouter initialEntries={['/chat/rooms/bowel/topics/t?post=2']}>
        <Routes>
          <Route path="/chat/rooms/bowel/topics/:topicId" element={<TopicPage />} />
          <Route path="/chat/rooms/general/topics/:topicId" element={<p>In General</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('In General')).toBeInTheDocument();
  });

  it('offers moving to whoever started it', () => {
    const current = db.topic;
    if (!current) throw new Error('the fixture should have a topic');
    db.topic = { ...current, authorId: 'me' };
    renderTopic();
    expect(screen.getByRole('button', { name: 'Move to another room' })).toBeInTheDocument();
  });

  it('offers moving to an administrator', () => {
    db.isAdmin = true;
    renderTopic();
    expect(screen.getByRole('button', { name: 'Move to another room' })).toBeInTheDocument();
  });

  it('offers it to nobody else', () => {
    renderTopic();
    expect(screen.queryByRole('button', { name: 'Move to another room' })).toBeNull();
  });
});

describe('a question asked with no details', () => {
  it('says the question once, as the title, not again as the first post', () => {
    db.posts = [post({ id: '1', body: 'Travelling with a bowel programme' })];
    renderTopic();
    expect(screen.getAllByText('Travelling with a bowel programme')).toHaveLength(1);
    expect(screen.getByText('No answers yet. Yours can be the first.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Travelling with a bowel programme' }),
    ).toBeInTheDocument();
  });

  it('still draws a first post that says more', () => {
    db.posts = [post({ id: '1', body: 'More about it.' })];
    renderTopic();
    expect(screen.getByText('More about it.')).toBeInTheDocument();
  });
});

describe('the way out of a topic', () => {
  it('offers Home, every room, and this room’s other topics', () => {
    renderTopic();
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole(
      'link',
    );
    expect(crumbs.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Home', '/home'],
      ['Rooms', '/chat?segment=rooms'],
      ['Bowel management', '/chat/rooms/bowel'],
    ]);
  });

  it('goes back to the Home pill it was opened from', () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/chat/rooms/bowel/topics/t', state: { from: 'home', segment: 'topics' } },
        ]}
      >
        <Routes>
          <Route path="/chat/rooms/:roomId/topics/:topicId" element={<TopicPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home?segment=topics',
    );
  });
});

describe('the header’s controls', () => {
  // Mute is stubbed in this file (useMute answers nothing), so the row is
  // checked with the two that draw.
  it('sit in one evenly spaced row, with no margins of their own', () => {
    db.isAdmin = true;
    renderTopic();
    const move = screen.getByRole('button', { name: 'Move to another room' });
    const remove = screen.getByRole('button', { name: 'Delete post' });
    expect(move.parentElement).toBe(remove.parentElement);
    expect(move.parentElement).toHaveClass('flex', 'gap-2');
    expect(move.className).not.toMatch(/\bm[trl]?-/);
    expect(remove.className).not.toMatch(/\bm[trl]?-/);
  });
});

describe('a question with no details, answered', () => {
  it('counts the answers from 1, and does not repeat the asker over nothing', () => {
    db.posts = [
      post({ id: '1', body: 'Travelling with a bowel programme' }),
      post({ id: '2', authorId: 'jan', body: 'First answer', createdAt: '2026-09-02T10:00:00Z' }),
    ];
    renderTopic();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByText('2/2')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit your post' })).toBeNull();
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
