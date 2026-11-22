import { Search, SquarePen } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CardsShown } from '@/components/cards-shown';
import { LoadingCards } from '@/components/loading-cards';
import { SegmentPills } from '@/components/segment-pills';
import { useAccount } from '@/lib/account';
import { useAttachmentUrls } from '@/lib/chat/attachments';
import { useChatAuthors } from '@/lib/chat/authors';
import { useMessageSearch } from '@/lib/chat/message-search';
import { useRealtimeRows } from '@/lib/chat/realtime';
import { roomsByCategory, useChatRooms, useRoomStats } from '@/lib/chat/rooms';
import { threadTitle, useMyThreads } from '@/lib/chat/threads';
import {
  CHAT_SEGMENTS,
  type ChatAuthor,
  type ChatSegment,
  type ChatThread,
} from '@/lib/chat/types';
import { matchesSearch } from '@/lib/search';
import { useCoalesced } from '@/lib/use-coalesced';
import { matchesChatSearch, splitShown } from '@/routes/chat/conversation-filters';
import { MessageResults } from '@/routes/chat/message-results';
import { RoomCard, RoomCategoryLabel } from '@/routes/chat/room-card';
import { ThreadRow } from '@/routes/chat/thread-row';

/**
 * Chat — direct messages, event groups, and topic rooms.
 *
 * **Being built, from 2026-09-18.** The discussion rooms are real, and so are
 * the conversations: a card opens a room, a row opens a conversation or a
 * group. What is not in this build — search, editing, blocking, attachments —
 * is absent rather than drawn and inert.
 *
 * ---------------------------------------------------------------------------
 * Why the rooms list is usually empty, and why that is right
 * ---------------------------------------------------------------------------
 * All twelve rooms are seeded closed and an administrator opens them one at a
 * time. CONTEXT.md records why: the club has five members who are not seeded
 * directory rows, and a room of two dozen members is empty by construction.
 * Twelve rooms opened at once is twelve rooms with four posts in them.
 *
 * So the ordinary first sight of this screen is the empty state, and the empty
 * state explains the policy rather than apologising for a lack of content.
 *
 * ---------------------------------------------------------------------------
 * Searching your chats
 * ---------------------------------------------------------------------------
 * The search box sits at the top however few chats there are (the owner,
 * 2026-11-19; before, it replaced the ask box only past ten). It finds conversations and rooms by name, and what was said
 * in the member's direct and group chats (the owner, 2026-11-19), each opening
 * on that message. Past the three latest of each kind, a conversation waits
 * behind More direct chats or More group chats unless it is unread.
 */

const SEGMENTS: [ChatSegment, string][] = [
  ['all', 'All'],
  ['direct', 'Direct'],
  ['groups', 'Groups'],
  ['rooms', 'Rooms'],
];

export default function ChatPage() {
  // The segment lives in the URL rather than in component state, for the
  // reason /events found first: opening a room and pressing back landed on
  // All, because the state died with the unmounted page, and a back arrow that
  // does not go back is worse than no back arrow. It is also what lets Me's
  // ROOMS counter point at the rooms rather than at the top of the screen.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('segment');
  const segment: ChatSegment = CHAT_SEGMENTS.includes(fromUrl as ChatSegment)
    ? (fromUrl as ChatSegment)
    : 'all';
  const setSegment = useCallback(
    (next: ChatSegment) => {
      // Replace rather than push: four pills are a filter, and tapping through
      // them should not mean four presses of back to leave the screen.
      setSearchParams(next === 'all' ? {} : { segment: next }, { replace: true });
    },
    [setSearchParams],
  );
  const account = useAccount();
  const { rooms, loading, error, reload: reloadRooms } = useChatRooms();
  const { stats, reload: reloadStats } = useRoomStats();
  const {
    threads,
    loading: threadsLoading,
    error: threadsError,
    reload: reloadThreads,
  } = useMyThreads();

  // Two unfiltered subscriptions, both scoped by RLS to what this member can
  // already see: every message in a conversation they are in, and every topic
  // in a room they can read. Unfiltered is the point — the list is about all of
  // them at once, and a subscription per row would be a socket per
  // conversation.
  // A busy group re-reads the list at most once per 1.5 s, the last kept.
  const reloadThreadsSoon = useCoalesced(reloadThreads);
  useRealtimeRows({ table: 'chat_messages', onChange: reloadThreadsSoon });
  // Every reply in every room changes a topic: recount at most once per 1.5 s.
  const reloadStatsSoon = useCoalesced(reloadStats);
  useRealtimeRows({ table: 'chat_topics', onChange: reloadStatsSoon });
  // And the rooms themselves, since a member can start one. A room appearing on
  // everybody's list the moment it is started is the point of letting members
  // start them, and chat_rooms carries nothing private — the select policy is
  // unchanged, so a closed room still never reaches a member.
  // A room changing recounts; a reconnect needs no recount of its own, as the
  // chat_topics channel's catch-up above has just read the stats.
  useRealtimeRows({
    table: 'chat_rooms',
    onChange: reloadRooms,
    onRow: () => {
      reloadRooms();
      reloadStatsSoon();
    },
  });

  const grouped = useMemo(() => roomsByCategory(rooms), [rooms]);

  // Direct conversations and groups share a table and a row, and the segments
  // are the two halves of it. `all` is both.
  //
  // A direct conversation nobody has spoken in is not listed — the owner's
  // call, 2026-09-21: tapping Message on a profile and leaving without a word
  // must not put that person in the list. The row is still in the database,
  // and `chat_open_direct` re-selects it by direct_key, so tapping Message
  // again lands in the same thread. A group is listed from the moment it is
  // made: somebody named it and chose who is in it, which is already a thing.
  const listed = threads.filter((thread) => thread.kind !== 'direct' || thread.lastAt !== null);

  const authors = useChatAuthors(
    threads.flatMap((thread) => [thread.otherMemberId, thread.lastAuthorId]),
  );

  // The search box is always there (the owner, 2026-11-19), however few
  // chats; asking is on Home.
  const [search, setSearch] = useState('');
  const searching = search.trim() !== '';
  const found = useMessageSearch(searching && segment !== 'rooms' ? search : '');
  const threadsById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);
  const conversations = listed.filter(
    (thread) =>
      (segment === 'all' || thread.kind === (segment === 'direct' ? 'direct' : 'group')) &&
      (!searching ||
        matchesChatSearch(
          thread,
          thread.otherMemberId ? (authors.get(thread.otherMemberId) ?? null) : null,
          search,
        )),
  );
  // Who started the member rooms. The seeded twelve have no starter, so on the
  // ordinary day this asks for nothing.
  const roomStarters = useChatAuthors(rooms.map((room) => room.createdBy));

  const shownRooms = searching
    ? grouped
        .map(
          ([category, inCategory]) =>
            [category, inCategory.filter((room) => matchesSearch(room.name, search))] as const,
        )
        .filter(([, inCategory]) => inCategory.length > 0)
    : grouped;

  const showRooms = segment === 'all' || segment === 'rooms';
  // The segment narrows the messages found as it narrows the conversations.
  const hits = found.hits.filter((hit) => {
    const kind = threadsById.get(hit.threadId)?.kind;
    return segment === 'all' || kind === (segment === 'direct' ? 'direct' : 'group');
  });
  const titleOf = (threadId: string) => {
    const thread = threadsById.get(threadId);
    if (!thread) return 'Conversation';
    const other = thread.otherMemberId ? authors.get(thread.otherMemberId) : undefined;
    return threadTitle(thread, other?.displayName ?? null);
  };
  const showConversations = segment !== 'rooms';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px]">
        <div className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-2">
          <h1 className="font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
            Chat
          </h1>
          <span className="flex items-center gap-2">
            {/* Writing to one person, from here (2026-10-10). Before, only a
              profile's Message button started a conversation. */}
            <Link
              to="/chat/new"
              className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-action px-4 font-bold font-head text-[0.875rem] text-white transition-colors hover:bg-action-hi"
            >
              <SquarePen aria-hidden="true" className="h-4 w-4" />
              New message
            </Link>
          </span>
        </div>
        <SegmentPills
          segments={SEGMENTS}
          value={segment}
          onChange={setSegment}
          className="max-w-[720px]"
        />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-3.5 pb-[18px] md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <label className="relative mb-3.5 block">
            <span className="sr-only">Search your chats</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-grey"
            />
            <input
              type="search"
              autoComplete="off"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Search chats and messages"
              className="min-h-[46px] w-full rounded-[13px] border-[1.6px] border-line bg-paper py-2 pr-3 pl-10 text-[0.9375rem] text-ink outline-none focus:border-emphasis"
            />
          </label>
          {showConversations ? (
            <Conversations
              segment={segment}
              threads={conversations}
              searching={searching}
              loading={threadsLoading}
              error={threadsError}
              authors={authors}
              viewerId={account.userId}
            >
              {/* The words said, above Start a group (the owner, 2026-11-19). */}
              {searching ? (
                <section aria-label="Messages" className="mt-4">
                  <h2 className="mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
                    Messages
                  </h2>
                  <MessageResults
                    query={search}
                    hits={hits}
                    searching={found.searching}
                    error={found.error}
                    viewerId={account.userId}
                    titleOf={titleOf}
                  />
                </section>
              ) : null}
            </Conversations>
          ) : null}

          {/* Not drawn under conversations that are still loading: they
              arrive above the rooms and pushed the whole list down the
              screen (Lighthouse, 2026-10-14: a 0.44 layout shift). */}
          {showRooms && !(showConversations && threadsLoading) ? (
            <>
              <h2 className="mt-4 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
                Discussion rooms
              </h2>
              {/* The mock's words, less "from before you joined": nobody
                  joins a room since 20260930000000. They still say the two
                  things a member needs to know before reading one: that the
                  whole history is there, and that none of it is public. */}
              <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
                Open to every member, to read and to write, with the whole history. Nothing here is
                public.
              </p>

              {loading ? (
                <LoadingCards label="Loading the rooms…" count={4} height={76} className="mt-3" />
              ) : error ? (
                <div className="py-10 text-center">
                  <p className="text-[0.875rem] text-ink2 leading-relaxed">
                    Could not load the rooms.
                  </p>
                  <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
                </div>
              ) : searching && shownRooms.length === 0 ? (
                <p className="py-6 text-center text-[0.875rem] text-grey leading-relaxed">
                  No room by that name.
                </p>
              ) : grouped.length === 0 ? (
                <p className="py-10 text-center text-[0.875rem] text-grey leading-relaxed">
                  No rooms are open yet.
                  <br />
                  The seeded ones open a few at a time, and anybody can start one.
                </p>
              ) : (
                shownRooms.map(([category, inCategory]) => (
                  <section key={category}>
                    <RoomCategoryLabel category={category} />
                    {inCategory.map((room) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        starter={room.createdBy ? (roomStarters.get(room.createdBy) ?? null) : null}
                        stats={stats.get(room.id)}
                      />
                    ))}
                  </section>
                ))
              )}

              {loading || error ? null : <NewRoomLink />}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The conversations, and what is honestly said where there are none.
 *
 * An empty list is never left as blank space. Every one of these says where to
 * go next, because "no conversations" with no way out of it is a dead end on
 * the one screen that is about reaching people — and the way out is different
 * in each segment:
 *
 *  - Direct: a conversation starts from somebody's profile, so that is what it
 *    says. There is no member picker here, deliberately; a direct message is a
 *    thing you send to a person you were just reading about.
 *  - Groups: a group starts here, so the control is here.
 *  - All: both, with the group control below the list.
 *  - A failure says so and shows the database's sentence.
 */
function Conversations({
  segment,
  threads,
  searching,
  loading,
  error,
  authors,
  viewerId,
  children,
}: {
  segment: ChatSegment;
  threads: ChatThread[];
  searching: boolean;
  loading: boolean;
  error: string | null;
  authors: Map<string, ChatAuthor>;
  viewerId: string | null;
  /** What goes between the conversations and Start a group. */
  children?: ReactNode;
}) {
  // Every group's picture signed in one request, under the reader's token, so
  // a group they have left comes back with no URL and draws its glyph.
  const pictures = useAttachmentUrls(
    threads.flatMap((thread) => (thread.photoPath ? [thread.photoPath] : [])),
  );
  const [opened, setOpened] = useState<{ direct: boolean; group: boolean }>({
    direct: false,
    group: false,
  });

  if (loading) {
    return <LoadingCards label="Loading your conversations…" count={4} height={64} rows />;
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-[0.875rem] text-ink2 leading-relaxed">
          Could not load your conversations.
        </p>
        <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
      </div>
    );
  }

  // A search lists everything it finds.
  const { shown: recent, more } = searching
    ? { shown: threads, more: { direct: [], group: [] } }
    : splitShown(threads);
  const rows = (list: ChatThread[]) => (
    <div className="rounded-[14px] border border-line bg-paper px-3.5">
      {list.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          other={thread.otherMemberId ? (authors.get(thread.otherMemberId) ?? null) : null}
          lastAuthor={thread.lastAuthorId ? (authors.get(thread.lastAuthorId) ?? null) : null}
          viewerId={viewerId}
          pictureUrl={thread.photoPath ? pictures.get(thread.photoPath) : null}
        />
      ))}
    </div>
  );

  // Direct chats, then groups, each with its own More below it (the owner,
  // 2026-11-05: "two sections instead of mixed"). Under All each is headed;
  // the Direct and Groups segments are already one of them.
  const sections = (['direct', 'group'] as const).flatMap((kind) => {
    const listed = recent.filter((thread) => thread.kind === kind);
    const hidden = more[kind];
    return listed.length + hidden.length > 0 ? [{ kind, listed, hidden }] : [];
  });

  return (
    <>
      {/* The conversations are on screen: page speed times them. */}
      <CardsShown />
      {sections.length > 0 ? (
        sections.map(({ kind, listed, hidden }, index) => {
          const label = kind === 'direct' ? 'direct chats' : 'group chats';
          return (
            <section key={kind} aria-label={kind === 'direct' ? 'Direct chats' : 'Group chats'}>
              {segment === 'all' ? (
                <h2
                  className={`${index > 0 ? 'mt-4' : ''} mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]`}
                >
                  {kind === 'direct' ? 'Direct chats' : 'Group chats'}
                </h2>
              ) : null}
              {listed.length > 0 ? rows(listed) : null}
              {hidden.length > 0 ? (
                <div className={listed.length > 0 ? 'mt-2' : ''}>
                  <button
                    type="button"
                    aria-expanded={opened[kind]}
                    onClick={() => {
                      setOpened((was) => ({ ...was, [kind]: !was[kind] }));
                    }}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-[13px] border border-line bg-paper px-3.5 font-bold font-head text-[0.875rem] text-ink transition-colors hover:bg-tint"
                  >
                    <span>
                      {opened[kind] ? 'Fewer' : 'More'} {label}
                    </span>
                    <span className="font-normal text-grey">{hidden.length}</span>
                  </button>
                  {opened[kind] ? <div className="mt-2">{rows(hidden)}</div> : null}
                </div>
              ) : null}
            </section>
          );
        })
      ) : searching ? (
        <p className="py-6 text-center text-[0.875rem] text-grey leading-relaxed">
          No chat by that name.
        </p>
      ) : (
        <p className="py-8 text-center text-[0.875rem] text-grey leading-relaxed">
          {segment === 'groups' ? (
            <>
              No groups yet.
              <br />
              Start one below, or open the group chat for an event you are going to.
            </>
          ) : (
            <>
              No conversations yet.
              <br />
              Message a member from their profile.
            </>
          )}
        </p>
      )}

      {children}

      {segment === 'groups' || segment === 'all' ? <NewGroupLink /> : null}
    </>
  );
}

/**
 * The way into a room somebody starts themselves.
 *
 * Present for every member and not only when the list is empty. The twelve
 * seeded rooms are starters, not the limit — the owner's decision on
 * 2026-09-20 — and a control that only appears when there is nothing else on
 * the screen reads as an apology for the emptiness rather than as an offer.
 *
 * The same dashed link as Start a group, for the same reasons.
 */
function NewRoomLink() {
  return (
    <Link
      to="/chat/rooms/new"
      className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-emphasis border-dashed font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-tint"
    >
      Start a room
    </Link>
  );
}

/**
 * The way into a group, and the one control on this screen that makes
 * something.
 *
 * A link and not a button: it goes to a page, it is worth opening in a new tab,
 * and a member who long-presses it gets the browser's own menu rather than
 * nothing. Full width and 48px tall, because it is the primary action of a
 * segment that is otherwise a list.
 */
function NewGroupLink() {
  return (
    <Link
      to="/chat/new-group"
      className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-emphasis border-dashed font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-tint"
    >
      Start a group
    </Link>
  );
}
