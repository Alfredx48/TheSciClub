import { Search } from 'lucide-react';
import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FilterButton } from '@/components/filter-button';
import { LoadingCards } from '@/components/loading-cards';
import { NotificationBell, useWideLayout } from '@/components/notification-bell';
import { AccountContext } from '@/lib/account-context';
import { useChatAuthors } from '@/lib/chat/authors';
import { usePostLikes, voteFor } from '@/lib/chat/likes';
import { useReactions } from '@/lib/chat/reactions';
import { useChatRooms } from '@/lib/chat/rooms';
import type { ChatPost } from '@/lib/chat/types';
import { usePostViews } from '@/lib/chat/views';
import { afterPaint, debugMark, debugScreenStart } from '@/lib/debug-log';
import { toHomeTopics, useHomeTopics } from '@/lib/home/topics';
import type { FeedItem, HomeSegment, HomeShow } from '@/lib/home/types';
import { useSession } from '@/lib/session';
import { QuickAsk } from '@/routes/chat/quick-ask';
import { ReactionBar } from '@/routes/chat/reaction-bar';
import { SharePostButton } from '@/routes/chat/share-post';
import { ComposeCard } from '@/routes/home/compose-card';
import { inSegment } from '@/routes/home/feed';
import { FeedbackCard } from '@/routes/home/feedback-card';
import { HomeFilterSheet } from '@/routes/home/filter-sheet';
import {
  activeFilterCount,
  chipsFor,
  EMPTY_FEED_FILTERS,
  type FeedFilterContext,
  type FeedFilters,
  matchesFeedFilters,
  openRoomsById,
} from '@/routes/home/filters';
import { HomeSearchReading } from '@/routes/home/home-search';
import { PhotoCard } from '@/routes/home/photo-card';
import { ProfileCard, useProfileAsk } from '@/routes/home/profile-card';
import { type CardLikes, TopicCard } from '@/routes/home/topic-card';

/**
 * Home: recent posts and photographs. Every card leads to something that
 * already exists; reporting, removal and mutes are theirs.
 *
 * - Posts alone (the owner, 2026-11-18): "let's skip loading events and peers
 *   for now in the home feed. Just do posts. We can add those back in later
 *   and people can find them in the peers and events tabs." Home was waiting
 *   for the events' and the members' reads before it drew a post. Their cards,
 *   their reads and the distance filter were here until the commit that says
 *   so; `feed.ts` still mixes the three kinds, and is handed no events and
 *   no people. Search reads them itself, once it is opened.
 * - A capped column, as Events is (`src/routes/events/page.tsx`): distance is effort.
 * - Reads once and does not subscribe: a list that reorders while read loses the reader's place.
 *   Do not add a subscription as a fix for "Home did not update".
 * - The filter (`filters.ts`) narrows the pill's built list, so "2 of 8 match" counts cards on
 *   screen. Component state, as on Events: carries across pills, a visit starts with none.
 */

// The kinds, under Type in the filter; Show there is whose posts (2026-11-18).
const TYPES: [HomeSegment, string][] = [
  ['everything', 'All'],
  ['questions', 'Questions'],
  ['topics', 'Posts'],
  ['photos', 'Photos'],
];
const NO_EVENTS: never[] = [];
const NO_PEOPLE: never[] = [];

/**
 * What the posts ask the club for, by debug mode's names for them: what the
 * list was waiting on when its posts were drawn (lib/debug-log.ts).
 */
const POST_REQUESTS = [
  'table:members',
  'rpc:home_startup',
  'rpc:home_feed',
  'rpc:home_topics_ranked',
  'rpc:home_topics_shown',
  'table:chat_topics',
  'table:chat_rooms',
];

export default function HomePage() {
  const [searching, setSearching] = useState(false);
  const wide = useWideLayout();
  const session = useSession();
  const startup = useContext(AccountContext)?.homeStartup;
  const memberId = session.status === 'signed-in' ? session.userId : null;

  // In the URL, as on Events and Chat: back returns to the pill, and it can be linked.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('segment');
  // An old link to the Events or People kind opens everything: Home has neither now.
  const segment: HomeSegment = TYPES.some(([id]) => id === fromUrl)
    ? (fromUrl as HomeSegment)
    : 'everything';
  const setSegment = useCallback(
    (next: HomeSegment) => {
      // Replace, so five pills are not five presses of back.
      setSearchParams(next === 'everything' ? {} : { segment: next }, { replace: true });
    },
    [setSearchParams],
  );
  // What every card hands to the screen it opens, so that screen's back link
  // says Home and returns to this pill.
  const linkState = useMemo(() => ({ from: 'home', segment }), [segment]);

  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  // Whose posts and in what order (the owner, 2026-11-18): read again for each choice.
  const view = useMemo(
    () => ({ show: filters.show, sort: filters.sort }),
    [filters.show, filters.sort],
  );
  const topicRead = useHomeTopics(view, startup?.feed);
  const rooms = useChatRooms(startup?.rooms);
  const [sheetOpen, setSheetOpen] = useState(false);

  const cardRooms = rooms.loading || rooms.error ? (topicRead.rooms ?? rooms.rooms) : rooms.rooms;
  const topics = useMemo(
    () => toHomeTopics(topicRead.topics, topicRead.posts, cardRooms),
    [topicRead.topics, topicRead.posts, cardRooms],
  );
  const authors = useChatAuthors(
    topics.flatMap((topic) => [
      topic.authorId,
      ...topic.replies.map((reply) => reply.post.authorId),
    ]),
  );
  // Likes on every topic and photograph: one read for every opening post,
  // whichever pill is showing, so switching pills does not read again.
  const openingPostIds = useMemo(
    () => topics.flatMap((topic) => (topic.opening ? [topic.opening.id] : [])),
    [topics],
  );
  const reactions = useReactions('post', openingPostIds, memberId, { live: false });
  const likes = usePostLikes(openingPostIds);
  const views = usePostViews(openingPostIds);

  const settled = !(topicRead.loading || (topicRead.rooms === undefined && rooms.loading));
  const failure = topicRead.error ?? rooms.error;
  const failures = failure ? [failure] : [];

  const items = useMemo(
    () => inSegment(segment, { topics, events: NO_EVENTS, people: NO_PEOPLE }),
    [segment, topics],
  );
  const filterContext = useMemo<FeedFilterContext>(
    () => ({
      openRooms: openRoomsById(cardRooms),
    }),
    [cardRooms],
  );
  const shown = useMemo(
    () => items.filter((item) => matchesFeedFilters(item, filters, filterContext)),
    [items, filters, filterContext],
  );
  const filterCount = activeFilterCount(filters) + (segment === 'everything' ? 0 : 1);

  // Debug mode (the owner, 2026-11-18: "when the user sees the text of the
  // posts", and "what are the constituent parts"): the moment the posts are
  // painted, told apart by whether they are the ones this visit read or the
  // ones a kept tab still had, and what the list had waited for.
  const { pathname } = useLocation();
  const postsDrawn =
    settled && shown.some((item) => item.kind === 'topic' || item.kind === 'photo');
  const needsRoomList = topicRead.rooms === undefined;
  useEffect(() => {
    if (pathname !== '/home' || !postsDrawn) return;
    const reached = debugScreenStart('/home');
    if (reached === null) return;
    const fresh = topicRead.readAt !== null && topicRead.readAt >= reached;
    return afterPaint(() => {
      if (fresh) {
        debugMark(
          '/home',
          'Fresh posts’ text on screen',
          needsRoomList
            ? POST_REQUESTS
            : POST_REQUESTS.filter((name) => name !== 'table:chat_rooms'),
        );
      } else debugMark('/home', 'Earlier posts’ text still on screen');
    });
  }, [pathname, postsDrawn, topicRead.readAt, needsRoomList]);
  const profile = useProfileAsk(memberId);

  /** A standing opener's likes, drawn as unknown until they are read. */
  function likesFor(opening: ChatPost | null): CardLikes | undefined {
    if (!opening) return undefined;
    return voteFor(likes, opening.id, memberId);
  }

  function draw(item: FeedItem) {
    switch (item.kind) {
      case 'topic':
        return (
          <TopicCard
            topic={item.topic}
            starter={item.topic.authorId ? (authors.get(item.topic.authorId) ?? null) : null}
            repliers={item.topic.replies.map((reply) =>
              reply.post.authorId ? (authors.get(reply.post.authorId) ?? null) : null,
            )}
            linkState={linkState}
            reactions={
              item.topic.opening ? (
                <ReactionBar
                  target={item.topic.opening.id}
                  what={item.topic.title}
                  state={reactions}
                  readerId={memberId}
                  share={
                    <SharePostButton
                      postId={item.topic.opening.id}
                      words={item.topic.title}
                      link={`/chat/rooms/${item.topic.roomId}/topics/${item.topic.id}`}
                      topicId={item.topic.id}
                    />
                  }
                />
              ) : null
            }
            likes={likesFor(item.topic.opening)}
            viewCount={
              views.loading ? undefined : (views.byPost.get(item.topic.opening?.id ?? '') ?? null)
            }
            answerAs={memberId}
          />
        );
      case 'photo':
        return (
          <PhotoCard
            topic={item.topic}
            author={item.topic.authorId ? (authors.get(item.topic.authorId) ?? null) : null}
            linkState={linkState}
            reactions={
              item.topic.opening ? (
                <ReactionBar
                  target={item.topic.opening.id}
                  what={item.topic.title}
                  state={reactions}
                  readerId={memberId}
                  share={
                    <SharePostButton
                      postId={item.topic.opening.id}
                      words={item.topic.title}
                      link={`/chat/rooms/${item.topic.roomId}/topics/${item.topic.id}`}
                      topicId={item.topic.id}
                    />
                  }
                />
              ) : null
            }
            likes={likesFor(item.topic.opening)}
            viewCount={
              views.loading ? undefined : (views.byPost.get(item.topic.opening?.id ?? '') ?? null)
            }
          />
        );
      // Neither is handed to the feed: see the note at the top.
      case 'event':
      case 'person':
        return null;
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {searching ? (
        <HomeSearchReading
          topics={topics}
          memberId={memberId}
          linkState={linkState}
          onClose={() => {
            setSearching(false);
          }}
        />
      ) : null}
      {/* All of it for the content (the owner, 2026-11-01): the lit tab says this is
          Home, and what the pills chose is in the filter. */}
      <h1 className="sr-only">Home</h1>
      <header className="flex-none border-line border-b bg-paper px-4 py-2 md:px-6">
        <div className="mx-auto flex w-full max-w-[var(--events-measure)] items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSearching(true);
            }}
            className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-tint px-3.5 text-[0.9375rem] text-grey"
          >
            <Search className="h-[17px] w-[17px] flex-none" strokeWidth={2} aria-hidden="true" />
            Search
          </button>
          <FilterButton
            count={filterCount}
            onClick={() => {
              setSheetOpen(true);
            }}
          />
          {/* Back on Home, right of Filter (the owner, 2026-11-06). A desktop
              has it in the top bar. */}
          {wide !== true ? <NotificationBell variant="round" className="md:hidden" /> : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-3.5 pb-[18px] md:px-6">
        <div className="mx-auto w-full max-w-[var(--events-measure)]">
          {/* Before the list loads. Posted from here (the owner, 2026-10-09); Photos keeps
              its picker card. */}
          {segment === 'photos' ? (
            <ComposeCard segment={segment} linkState={linkState} />
          ) : (
            <QuickAsk rooms={rooms.rooms} linkState={linkState} className="mb-[11px]" />
          )}

          {!settled ? (
            <LoadingCards label="Loading…" height={170} />
          ) : (
            <>
              {failures.length > 0 ? <Problem sentences={failures} /> : null}
              {shown.length > 0 ? (
                <>
                  <ul className="arrive">
                    {shown.map((item, index) => (
                      <Fragment key={item.key}>
                        <li className="mb-[11px]">{draw(item)}</li>
                        {/* Below the first card (the owner, 2026-10-28): what
                            members think of the app. */}
                        {index === 0 ? (
                          <FeedbackCard
                            rooms={rooms.rooms}
                            linkState={linkState}
                            className="mb-[11px]"
                          />
                        ) : null}
                        {/* Sixth (the owner, 2026-11-01), or last in a shorter feed. */}
                        {profile.ask && index === Math.min(4, shown.length - 1) ? (
                          <ProfileCard
                            ask={profile.ask}
                            onNotNow={profile.notNow}
                            className="mb-[11px]"
                          />
                        ) : null}
                      </Fragment>
                    ))}
                  </ul>
                  <SeeMore segment={segment} />
                </>
              ) : failures.length > 0 ? null : items.length > 0 ? (
                // The pill has cards and the filter kept none.
                <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
                  Nothing matches that yet. Try fewer filters.
                </p>
              ) : (
                <EmptyList segment={segment} show={filters.show} />
              )}
            </>
          )}
        </div>
      </div>

      {sheetOpen ? (
        <HomeFilterSheet
          chips={chipsFor(items, filters, filterContext)}
          segments={TYPES}
          segment={segment}
          onSegment={setSegment}
          filters={filters}
          matchCount={shown.length}
          total={items.length}
          activeCount={filterCount}
          onChange={setFilters}
          onClear={() => {
            setFilters(EMPTY_FEED_FILTERS);
            setSegment('everything');
          }}
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** A failure, said once, above whatever did load. */
function Problem({ sentences }: { sentences: string[] }) {
  return (
    <div
      role="alert"
      className="mb-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
    >
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}

const LINK_CLASS =
  'inline-flex min-h-[2.75rem] items-center font-semibold text-[0.875rem] text-emphasis underline decoration-line underline-offset-2 hover:decoration-emphasis';

/** Where the rest of a single-kind list lives. Everything has no "rest". */
function SeeMore({ segment }: { segment: HomeSegment }) {
  const more: Partial<Record<HomeSegment, [string, string]>> = {
    questions: ['/chat?segment=rooms', 'See the rooms'],
    topics: ['/chat?segment=rooms', 'See the rooms'],
    photos: ['/chat?segment=rooms', 'See the rooms'],
    events: ['/events', 'See the whole calendar'],
    people: ['/peers', 'See everyone in Peers'],
  };
  const link = more[segment];
  if (!link) return null;
  return (
    <p className="text-center">
      <Link to={link[0]} className={LINK_CLASS}>
        {link[1]}
      </Link>
    </p>
  );
}

/** Each empty pill says which emptiness it is, and links to where to go instead. */
function EmptyList({ segment, show }: { segment: HomeSegment; show: HomeShow }) {
  const empty: Record<HomeSegment, [string, [string, string] | null]> = {
    everything: ['Nothing here yet.', null],
    questions: [
      'No questions yet. Ask one above: no question is too basic.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    topics: [
      'No posts yet. Rooms open a few at a time, and anybody can start one.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    photos: [
      'No photographs yet. A post with a photograph shows up here.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    events: [
      'Nothing on the calendar near you in the next 30 days.',
      ['/events', 'See the whole calendar'],
    ],
    people: ['Nobody new to suggest today.', ['/peers', 'See everyone in Peers']],
  };
  // A choice under Show with nothing in it says so in its own words.
  const ofShow: Record<Exclude<HomeShow, 'all'>, [string, [string, string] | null]> = {
    mine: ['You haven’t posted anything here yet.', ['/chat?segment=rooms', 'See the rooms']],
    replied: ['You haven’t replied to anything here yet.', null],
    orgs: [
      'Nothing from your organizations yet.',
      ['/events?segment=orgs', 'See the organizations'],
    ],
  };
  const [sentence, link] = show === 'all' ? empty[segment] : ofShow[show];
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[0.875rem] text-grey leading-relaxed">{sentence}</p>
      {link ? (
        <p className="mt-2">
          <Link to={link[0]} className={LINK_CLASS}>
            {link[1]}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
