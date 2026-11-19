import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SharedPosts from '@/lib/chat/shared-posts';
import type { ShareTarget } from '@/lib/chat/shared-posts';
import type * as Threads from '@/lib/chat/threads';
import type { ChatAuthor, ChatThread } from '@/lib/chat/types';
import type * as Members from '@/lib/members';
import { makeMember } from '@/test/factory';
import type { BrowseMember } from '@/types/domain';

const db = vi.hoisted(() => ({
  threads: [] as ChatThread[],
  members: [] as BrowseMember[],
  shared: [] as { postId: string; target: ShareTarget; authorId: string; line: string }[],
  failure: null as string | null,
  isAdmin: false,
  orgAdmin: false,
}));

vi.mock('@/lib/account', () => ({
  useAccount: () => ({ status: 'member', userId: 'me', isAdmin: db.isAdmin, displayName: 'Me' }),
}));
vi.mock('@/lib/chat/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof Threads>()),
  useMyThreads: () => ({
    threads: db.threads,
    loading: false,
    error: null,
    reload: () => undefined,
  }),
}));
vi.mock('@/lib/chat/authors', () => ({
  useChatAuthors: () =>
    new Map<string, ChatAuthor>([
      [
        'jan',
        {
          id: 'jan',
          displayName: 'Jan',
          username: null,
          photoPath: null,
          photoAlt: null,
          avatarColor: null,
          level: null,
          isAdmin: false,
          hasProfile: true,
        },
      ],
    ]),
}));
vi.mock('@/lib/members', async (importOriginal) => ({
  ...(await importOriginal<typeof Members>()),
  useBrowseMembers: () => ({ members: db.members, loading: false, error: null, signedOut: false }),
}));
vi.mock('@/lib/chat/shared-posts', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedPosts>()),
  sharePost: (postId: string, target: ShareTarget, authorId: string, line: string) => {
    db.shared.push({ postId, target, authorId, line });
    if (db.failure) return Promise.resolve({ ok: false, error: db.failure });
    const threadId = 'threadId' in target ? target.threadId : `thread-${target.memberId}`;
    return Promise.resolve({ ok: true, threadId });
  },
}));
vi.mock('@/components/member-avatar', () => ({
  MemberAvatar: () => null,
  GroupAvatar: () => null,
}));

const shared = vi.hoisted(() => ({
  links: [] as { url: string; text: string }[],
  outcome: 'copied',
}));
vi.mock('@/lib/organization-representatives', () => ({
  useMyOrganizations: (memberId: string | null) => ({
    ids: new Set(memberId && db.orgAdmin ? ['ncs'] : []),
    loading: false,
  }),
}));
vi.mock('@/lib/share-link', () => ({
  shareLink: (link: { url: string; text: string }) => {
    shared.links.push(link);
    return Promise.resolve(shared.outcome);
  },
  canShareElsewhere: () => true,
  copyLink: (url: string) => {
    shared.links.push({ url, text: '' });
    return Promise.resolve(true);
  },
}));

const { SharePostButton } = await import('@/routes/chat/share-post');

function Where() {
  return <p>at {useLocation().pathname}</p>;
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={['/chat/rooms/general/topics/t1']}>
      <Routes>
        <Route
          path="/chat/rooms/general/topics/t1"
          element={
            <SharePostButton
              postId="p1"
              words="Which **cushion** do you use?"
              link="/chat/rooms/general/topics/t1?post=p1"
            />
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const thread = (o: Partial<ChatThread>): ChatThread => ({
  id: 'th1',
  kind: 'direct',
  name: null,
  eventId: null,
  createdAt: '2026-10-20T09:00:00Z',
  lastMessageAt: '2026-10-20T10:00:00Z',
  memberCount: 2,
  otherMemberId: 'jan',
  lastBody: 'Hello.',
  lastAuthorId: 'jan',
  lastAt: '2026-10-20T10:00:00Z',
  lastRemoved: false,
  unread: false,
  photoPath: null,
  lastNotice: null,
  ...o,
});

beforeEach(() => {
  db.threads = [
    thread({ id: 'dm-jan' }),
    thread({ id: 'grp', kind: 'group', name: 'Wheel fixers', otherMemberId: null, memberCount: 5 }),
    // Somebody who has left: nobody to send to.
    thread({ id: 'dm-gone', otherMemberId: null }),
  ];
  db.members = [
    makeMember({ id: 'me', displayName: 'Me' }),
    makeMember({ id: 'sam', displayName: 'Sam', username: 'wheels' }),
  ];
  db.shared = [];
  db.failure = null;
});

describe('sharing a post into a conversation', () => {
  it('is a button named for the post, opening a sheet with its heading focused', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(
      screen.getByRole('button', {
        name: 'Share “Which cushion do you use?”',
      }),
    );
    const sheet = screen.getByRole('dialog', { name: 'Share post' });
    expect(within(sheet).getByRole('heading', { name: 'Share post' })).toHaveFocus();
  });

  it('lists the conversations as choices, and not one with nobody left in it', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    const choices = within(screen.getByRole('group', { name: 'Send to' })).getAllByRole('radio');
    expect(choices.map((c) => c.closest('label')?.textContent)).toEqual([
      'JanDirect message',
      'Wheel fixersGroup · 5 members',
    ]);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends to the chosen group with a line, and offers the conversation after', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.click(screen.getByRole('radio', { name: /Wheel fixers/ }));
    await user.type(screen.getByRole('textbox', { name: 'Add a message (optional)' }), 'Look');
    await user.click(screen.getByRole('button', { name: 'Send to Wheel fixers' }));
    expect(db.shared).toEqual([
      { postId: 'p1', target: { threadId: 'grp' }, authorId: 'me', line: 'Look' },
    ]);
    await waitFor(() => {
      expect(screen.getByText('Shared with Wheel fixers.')).toHaveFocus();
    });
    await user.click(screen.getByRole('link', { name: 'Go to the conversation' }));
    expect(screen.getByText('at /chat/t/grp')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts a direct conversation with somebody else', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    const more = screen.getByRole('button', { name: 'Someone else' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.queryByRole('radio', { name: /^Me/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Sam/ }));
    await user.click(screen.getByRole('button', { name: 'Send to Sam' }));
    expect(db.shared[0]?.target).toEqual({ memberId: 'sam' });
    expect(db.shared[0]?.line).toBe('');
    expect(await screen.findByText('Shared with Sam.')).toBeInTheDocument();
  });

  it('keeps a chosen member while searching, and lets go of them when the list is hidden', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.click(screen.getByRole('button', { name: 'Someone else' }));
    await user.click(screen.getByRole('radio', { name: /Sam/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zz');
    expect(screen.getByRole('radio', { name: /Sam/ })).toBeChecked();
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.click(screen.getByRole('button', { name: 'Hide the members' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('finds a conversation by name, and hides the rest', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'FIXERS');
    const group = screen.getByRole('group', { name: 'Send to' });
    expect(within(group).getByRole('radio', { name: /Wheel fixers/ })).toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: /Jan/ })).toBeNull();
    expect(screen.queryByText(/Nobody matches/)).toBeNull();
  });

  it('finds somebody with no conversation by @username, without opening Someone else', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '@wheels');
    expect(screen.queryByRole('radio', { name: /Jan/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Sam/ }));
    await user.click(screen.getByRole('button', { name: 'Send to Sam' }));
    expect(db.shared[0]?.target).toEqual({ memberId: 'sam' });
  });

  it('lists somebody with a conversation once', async () => {
    const user = userEvent.setup();
    db.members = [...db.members, makeMember({ id: 'jan', displayName: 'Jan' })];
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'jan');
    expect(screen.getAllByRole('radio', { name: /Jan/ })).toHaveLength(1);
  });

  it('keeps a member chosen from a search on screen once it is cleared', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'sam');
    await user.click(screen.getByRole('radio', { name: /Sam/ }));
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    expect(screen.getByRole('radio', { name: /Sam/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Send to Sam' })).toBeEnabled();
  });

  it('says when nobody matches', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zz');
    expect(screen.getByText('Nobody matches “zz”.')).toBeInTheDocument();
  });

  it('does not send when Enter is pressed in the search', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.click(screen.getByRole('radio', { name: /Jan/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'x{Enter}');
    expect(db.shared).toEqual([]);
  });

  it('says why when the database refuses, and keeps the choice', async () => {
    const user = userEvent.setup();
    db.failure = "You can't message this member.";
    renderButton();
    await user.click(screen.getByRole('button', { name: /^Share / }));
    await user.click(screen.getByRole('radio', { name: /Jan/ }));
    await user.click(screen.getByRole('button', { name: 'Send to Jan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't message this member.");
    expect(screen.getByRole('radio', { name: /Jan/ })).toBeChecked();
  });

  it('closes on Escape, giving focus back to Share', async () => {
    const user = userEvent.setup();
    renderButton();
    const share = screen.getByRole('button', { name: /^Share / });
    await user.click(share);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(share).toHaveFocus();
  });
});

// The owner, 2026-10-28: a link to send outside the club; 2026-11-16: "only
// admins can share them and only in private discussions, not on any platforms";
// 2026-11-19: "any active admin of any organization".
describe('a post’s link outside the club', () => {
  it('is offered to an organization’s admin too', async () => {
    db.orgAdmin = true;
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Share / }));
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share elsewhere' })).not.toBeInTheDocument();
    db.orgAdmin = false;
  });

  it('is not offered to a member, and is only copied by an administrator, with none of its words', async () => {
    db.isAdmin = false;
    const { unmount } = renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Share / }));
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share elsewhere' })).not.toBeInTheDocument();
    unmount();

    db.isAdmin = true;
    shared.links = [];
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /^Share / }));
    expect(screen.queryByRole('button', { name: 'Share elsewhere' })).not.toBeInTheDocument();
    expect(screen.getByText(/only in a private message/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(shared.links).toEqual([
      { url: `${window.location.origin}/chat/rooms/general/topics/t1?post=p1`, text: '' },
    ]);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    db.isAdmin = false;
  });
});
