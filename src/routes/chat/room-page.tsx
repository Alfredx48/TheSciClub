import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { LoadingCards } from '@/components/loading-cards';
import { SegmentPills } from '@/components/segment-pills';
import { useAccount } from '@/lib/account';
import { useAuthorPlaces } from '@/lib/chat/author-places';
import { useChatAuthors } from '@/lib/chat/authors';
import { usePostLikes, voteFor } from '@/lib/chat/likes';
import { PRICED_ROOM, useListingPrices } from '@/lib/chat/listing-prices';
import { useTopicOpeningPosts } from '@/lib/chat/opening-posts';
import { useRealtimeRows } from '@/lib/chat/realtime';
import { useChatRooms, useRoomStats } from '@/lib/chat/rooms';
import { sortTopics, useRoomTopics } from '@/lib/chat/topics';
import { ROOM_SORTS, type RoomCategory, type RoomSort } from '@/lib/chat/types';
import { useMinute } from '@/lib/chat/use-minute';
import { useCoalesced } from '@/lib/use-coalesced';
import { ChatBreadcrumb } from '@/routes/chat/breadcrumb';
import { ListingGrid } from '@/routes/chat/listing-grid';
import { MuteButton } from '@/routes/chat/mute-button';
import { QuickAsk } from '@/routes/chat/quick-ask';
import { lastActivity, roomCounts, roomInitial } from '@/routes/chat/room-card';
import { TopicRow } from '@/routes/chat/topic-row';
import { ShareRoomButton } from '@/routes/events/share-event';

/**
 * One discussion room: its topics, and the way in.
 *
 * ---------------------------------------------------------------------------
 * Nothing waits for anything
 * ---------------------------------------------------------------------------
 * The room, its topics and every post in them are readable by any member —
 * that is the promise /chat prints, and the select policies keep it. Since
 * 20260930000000 writing is the same: any member starts a topic in an open
 * room, and there is no Join. Until then joining bought the right to write,
 * and this screen carried a join bar where a topic carries its composer; the
 * owner took joining out on 2026-09-29 (HANDOFF.md "What Home is", decision 8).
 *
 * ---------------------------------------------------------------------------
 * A closed room, for the one person who can see it
 * ---------------------------------------------------------------------------
 * The select policy hides a closed room from every member, so arriving here
 * with `openedAt` null means the reader is an administrator. They are told, in
 * the place they would otherwise assume a working room: seeding a closed room
 * is the reason they can see one at all, and an administrator who forgets it is
 * shut will wonder why nobody is answering.
 *
 * ---------------------------------------------------------------------------
 * Sorting
 * ---------------------------------------------------------------------------
 * The mock's sort bar, as the same pills every other screen uses rather than
 * its own `.sortb` control — a third kind of pill on the fourth screen is how a
 * product stops looking like one product.
 */

const SORT_LABELS: Record<RoomSort, string> = {
  top: 'Top',
  activity: 'Activity',
  replies: 'Replies',
  views: 'Views',
};

const CATEGORY_ICON: Record<RoomCategory, string> = {
  General: 'text-emphasis',
  Other: 'text-emphasis',
  Body: 'text-room-body',
  Mind: 'text-room-mind',
  Life: 'text-room-life',
  Family: 'text-room-family',
  Kit: 'text-room-kit',
  // Kit's colour: most of what changes hands here is kit.
  Classifieds: 'text-room-kit',
  Places: 'text-room-places',
};

export default function RoomPage() {
  useMinute();
  const { roomId } = useParams<{ roomId: string }>();
  const account = useAccount();
  const { rooms, loading: roomsLoading } = useChatRooms();
  // Home's pill, when the room was opened from a card's room name there.
  const location = useLocation();
  // Top first (the owner, 2026-11-18): votes, an administrator's boost, recent activity, and what
  // the reader has not opened yet, ranked by the database. The others order the rows read.
  const [sort, setSort] = useState<RoomSort>('top');
  // Scrolled: a line under the way back, so what passes under it reads as
  // passing under, not as cut off.
  const [scrolled, setScrolled] = useState(false);
  const {
    topics,
    loading: topicsLoading,
    error,
    reload,
    hasMore,
    loadingMore,
    showMore,
  } = useRoomTopics(roomId, sort === 'top');
  const { stats, reload: reloadStats } = useRoomStats(roomId);
  const { byTopic: openingPosts, reload: reloadOpeners } = useTopicOpeningPosts(
    topics.map((topic) => topic.id),
  );
  const likes = usePostLikes([...openingPosts.values()].filter((id): id is string => id !== null));

  // Watching chat_topics catches both halves of what this screen shows: a new
  // topic is an INSERT, and a reply to an existing one is an UPDATE, because
  // the chat_posts trigger moves last_post_at and reply_count on the topic row.
  // One subscription rather than a second on chat_posts, which cannot be
  // filtered by room anyway. At most once per 1.5 s, the last change kept.
  const reloadAll = useCoalesced(() => {
    reload();
    reloadStats();
    likes.reload();
    reloadOpeners();
  });
  useRealtimeRows({
    table: 'chat_topics',
    filter: roomId ? `room_id=eq.${roomId}` : undefined,
    onChange: reloadAll,
    enabled: Boolean(roomId),
  });

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const sorted = useMemo(() => sortTopics(topics, sort), [topics, sort]);
  // Every face on every row, asked for once — and whoever started the room,
  // where a member did. The seeded twelve add nothing to this list.
  const authors = useChatAuthors([
    ...topics.flatMap((topic) => topic.participantIds),
    room?.createdBy ?? null,
  ]);
  const starter = room?.createdBy ? (authors.get(room.createdBy) ?? null) : null;
  // In Classifieds, each listing says where its seller is (the owner, 2026-11-12).
  const classifieds = room?.category === 'Classifieds';
  const places = useAuthorPlaces(
    topics.map((topic) => topic.authorId),
    classifieds,
  );
  const prices = useListingPrices(
    topics.map((topic) => topic.id),
    room?.id === PRICED_ROOM,
  );

  if (roomsLoading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }

  if (!room) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <BackLink to="/chat" label="Chat" />
          <p className="mt-6 text-[0.875rem] text-ink2 leading-relaxed">
            There is no such room, or it is not open yet.
          </p>
          <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">
            Rooms open one at a time, as there are members to fill them.
          </p>
        </div>
      </div>
    );
  }

  const closed = room.openedAt === null;
  const count = stats.get(room.id);
  // An administrator may post in a closed room — seeding one is why they can
  // see it. Everybody else needs the room open, and nothing more.
  const canPost = account.isAdmin || !closed;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Only the way back stays put; the room's name, its counts and the
          sort scroll away with the posts (the owner, 2026-11-19: "do not
          freeze the title and stuff, it should all scroll, only the reverse
          breadcrumb should stay"). */}
      <div
        className={`flex-none border-b bg-paper px-[18px] pt-3 pb-1.5 ${scrolled ? 'border-line' : 'border-transparent'}`}
      >
        <div className="mx-auto w-full max-w-[720px]">
          <ChatBreadcrumb state={location.state as unknown} />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        onScroll={(event) => {
          setScrolled(event.currentTarget.scrollTop > 0);
        }}
      >
        <header className="border-line border-b bg-paper px-[18px] pt-1.5">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="flex items-start gap-[11px]">
              <span
                aria-hidden="true"
                className={`grid h-[2.4em] w-[2.4em] flex-none place-items-center rounded-[12px] bg-tint text-[1.125rem] leading-none ${CATEGORY_ICON[room.category]}`}
              >
                {room.icon ?? roomInitial(room.name)}
              </span>
              <span className="min-w-0 flex-1">
                {/* Share and Mute beside the name only, so the description and
                  counts below keep the column's width. */}
                <span className="flex items-start gap-2">
                  <h1 className="min-w-0 flex-1 font-extrabold font-head text-[1.125rem] text-ink leading-[1.25]">
                    {room.name}
                  </h1>
                  {/* A room's replies notify whoever started the topic, so muting a
                    room means: no notifications for replies to my topics in it. */}
                  <span className="mt-0.5 flex flex-none items-start gap-1.5">
                    {/* Not a closed room: no member could open the link. */}
                    {closed ? null : <ShareRoomButton id={room.id} name={room.name} />}
                    <MuteButton
                      target={{ kind: 'room', id: room.id }}
                      what="replies to your posts in this room"
                    />
                  </span>
                </span>
                <p className="mt-[3px] text-[0.78125rem] text-ink2 leading-[1.45]">
                  {room.description}
                </p>
                {/* Only for a room a member started. The seeded twelve came with
                  the club and have nobody to name. */}
                {room.createdBy ? (
                  <p className="mt-[3px] text-[0.75rem] text-grey leading-[1.45]">
                    Started by {starter?.displayName ?? 'a deleted member'}
                  </p>
                ) : null}
                {/* Left off entirely until there is something to count, for the
                  reason room-card.tsx gives: two zeros read as a room that
                  failed rather than as one that has not started. And "open to
                  all" is not a promise to make about a closed room, which is
                  open to nobody — the banner below says so instead. */}
                {count && count.topicCount > 0 ? (
                  <>
                    <p className="mt-[5px] font-semibold text-[0.78125rem] text-emphasis">
                      {roomCounts(count)}
                    </p>
                    <p className="text-[0.75rem] text-grey leading-[1.45]">
                      {count.lastActivityAt ? lastActivity(count.lastActivityAt) : null}
                      {count.lastActivityAt && !closed ? ' · ' : null}
                      {closed ? null : 'Open to all, full history'}
                    </p>
                  </>
                ) : null}
              </span>
            </div>

            {closed ? (
              <p className="mt-2.5 rounded-[11px] bg-tint px-3 py-2 text-[0.78125rem] text-ink2 leading-[1.45]">
                This room is closed. No member can see it yet — you can, because you are an
                administrator, so that there is something here before it opens.
              </p>
            ) : null}

            {/* "Sort by", not "Topic": the owner read "Topic" as a fourth chip.
              A fieldset named by it, so a screen reader hears "Sort by" before
              "Activity, pressed" rather than a pressed button with no context. */}
            <fieldset
              aria-labelledby="room-sort-label"
              className="mt-1 flex min-w-0 items-center gap-2 border-line border-t pt-1"
            >
              <span
                id="room-sort-label"
                className="flex-none font-bold text-[0.78125rem] text-ink2"
              >
                Sort by
              </span>
              <SegmentPills
                segments={ROOM_SORTS.map((key) => [key, SORT_LABELS[key]] as const)}
                value={sort}
                onChange={setSort}
                className="flex-1"
              />
            </fieldset>
          </div>
        </header>

        <div className="px-4 pt-2.5 pb-[18px] md:px-6">
          <div className="mx-auto w-full max-w-[720px]">
            {/* At the top, where it is seen first, rather than after every
              topic (the owner, 2026-10-09): typed into and posted from here,
              with "Add details or a photo" for the full form. */}
            {canPost ? (
              classifieds ? (
                // Straight to the full form, where photographs come first: a
                // listing is mostly its picture (the owner, 2026-11-12).
                <Link
                  to={`/chat/rooms/${room.id}/new`}
                  className="mb-2.5 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi"
                >
                  {room.id === 'looking-for' ? 'Ask for something' : 'List something'}
                </Link>
              ) : (
                <QuickAsk
                  key={`${account.userId}:${room.id}`}
                  memberId={account.userId}
                  rooms={rooms}
                  fixedRoom={room}
                  className="mb-2.5"
                />
              )
            ) : null}
            {topicsLoading ? (
              <LoadingCards label="Loading the posts…" count={4} height={96} />
            ) : error ? (
              <div className="py-10 text-center">
                <p className="text-[0.875rem] text-ink2 leading-relaxed">
                  Could not load the posts.
                </p>
                <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
              </div>
            ) : sorted.length === 0 ? (
              // Invites the first one; does not pretend there is activity.
              <p className="py-10 text-center text-[0.875rem] text-grey leading-relaxed">
                {classifieds ? 'Nothing listed here yet.' : 'Nothing has been asked here yet.'}
                <br />
                {canPost
                  ? classifieds
                    ? 'Be the first.'
                    : 'Start the first topic.'
                  : 'An administrator can start one before the room opens.'}
              </p>
            ) : classifieds ? (
              <ListingGrid
                topics={sorted}
                openingPosts={openingPosts}
                places={places}
                prices={prices}
                free={room.id === 'giving-away'}
                priced={room.id === PRICED_ROOM}
              />
            ) : (
              sorted.map((topic) => {
                const postId = openingPosts.get(topic.id);
                return (
                  <TopicRow
                    key={topic.id}
                    topic={topic}
                    authors={authors}
                    place={topic.authorId ? places.get(topic.authorId) : undefined}
                    likes={
                      postId
                        ? voteFor(
                            likes,
                            postId,
                            account.status === 'member' ? account.userId : null,
                          )
                        : undefined
                    }
                  />
                );
              })
            )}
            {/* Top or newest activity first, 40 at a time; the other sorts order those shown. */}
            {!topicsLoading && !error && hasMore ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={showMore}
                  disabled={loadingMore}
                  className="min-h-[44px] rounded-[10px] bg-tint px-4 py-2 font-semibold text-[0.8125rem] text-emphasis transition-colors hover:bg-line"
                >
                  {loadingMore ? 'Loading…' : 'Show more posts'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
