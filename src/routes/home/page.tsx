import { Search } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FilterButton } from '@/components/filter-button';
import { LoadingCards } from '@/components/loading-cards';
import { NotificationBell, useWideLayout } from '@/components/notification-bell';
import { useRsvpSheet } from '@/components/rsvp-sheet';
import { useChatAuthors } from '@/lib/chat/authors';
import { usePostLikes } from '@/lib/chat/likes';
import { useReactions } from '@/lib/chat/reactions';
import { useChatRooms } from '@/lib/chat/rooms';
import { useMyThreads } from '@/lib/chat/threads';
import type { ChatPost } from '@/lib/chat/types';
import { usePostViews } from '@/lib/chat/views';
import { setRsvp, useEvents, useViewerEvents } from '@/lib/events';
import { toHomeTopics, useHomeTopics } from '@/lib/home/topics';
import { type FeedItem, HOME_SEGMENTS, type HomeSegment } from '@/lib/home/types';
import { useHome } from '@/lib/home-state';
import { useMapData } from '@/lib/map-data';
import { useBrowseMembers } from '@/lib/members';
import { useNearHome } from '@/lib/near-home';
import { useOrganizations } from '@/lib/organizations';
import { useSession } from '@/lib/session';
import { QuickAsk } from '@/routes/chat/quick-ask';
import { ReactionBar } from '@/routes/chat/reaction-bar';
import { SharePostButton } from '@/routes/chat/share-post';
import { EventCard } from '@/routes/events/event-card';
import { dateWindowRange } from '@/routes/events/filters';
import { ComposeCard } from '@/routes/home/compose-card';
import {
  EVENT_HORIZON_DAYS,
  inSegment,
  pickEvents,
  SEGMENT_PEOPLE,
  suggestPeople,
} from '@/routes/home/feed';
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
import { HomeSearch } from '@/routes/home/home-search';
import { PersonCard } from '@/routes/home/person-card';
import { PhotoCard } from '@/routes/home/photo-card';
import { ProfileCard, useProfileAsk } from '@/routes/home/profile-card';
import { type CardLikes, TopicCard } from '@/routes/home/topic-card';
import { membersBeyond } from '@/routes/peers/filters';
import type { ClubEvent, RsvpStatus } from '@/types/domain';

/**
 * Home: recent topics, photographs, upcoming events and members, from the mock's `homePage()`.
 * Every card leads to something that already exists; reporting, removal and mutes are theirs.
 *
 * - A capped column, as Events is (`src/routes/events/page.tsx`): distance is effort.
 * - Reads once and does not subscribe: a list that reorders while read loses the reader's place.
 *   Do not add a subscription as a fix for "Home did not update".
 * - Everything waits for all three sources, so `buildFeed` does not re-mix under the reader. A
 *   failed source says so once at the top; the rest still draws.
 * - The filter (`filters.ts`) narrows the pill's built list, so "2 of 8 match" counts cards on
 *   screen. Component state, as on Events: carries across pills, a visit starts with none.
 */

const SEGMENTS: [HomeSegment, string][] = [
  ['everything', 'Everything'],
  ['questions', 'Questions'],
  ['topics', 'Topics'],
  ['photos', 'Photos'],
  ['events', 'Events'],
  ['people', 'People'],
];

type Source = 'topics' | 'events' | 'people';

/** Which sources each pill draws from, and so waits for. */
const SOURCES: Record<HomeSegment, Source[]> = {
  everything: ['topics', 'events', 'people'],
  questions: ['topics'],
  topics: ['topics'],
  photos: ['topics'],
  events: ['events'],
  people: ['people'],
};

export default function HomePage() {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const wide = useWideLayout();
  const session = useSession();
  const memberId = session.status === 'signed-in' ? session.userId : null;

  // In the URL, as on Events and Chat: back returns to the pill, and it can be linked.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('segment');
  const segment: HomeSegment = HOME_SEGMENTS.includes(fromUrl as HomeSegment)
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

  const topicRead = useHomeTopics();
  const rooms = useChatRooms();
  // Only the days Home shows (pickEvents); it once read every stored event. Fixed per visit.
  const [eventWindow] = useState(() => {
    const to = new Date(Date.now() + (EVENT_HORIZON_DAYS + 1) * 86_400_000).toISOString();
    const from = dateWindowRange('any')?.from;
    return from ? { from, to } : { to };
  });
  const eventsRead = useEvents(eventWindow);
  // Within the same distance Events starts on, so Home does not suggest what
  // Events would leave out.
  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const near = useNearHome(filters.withinMiles);
  // Peers measured as the Peers tab does, from what the map holds.
  const home = useHome();
  const mapData = useMapData(filters.withinMiles !== null);
  const peersFar = useMemo(
    () => membersBeyond(mapData.contents, filters.withinMiles),
    [mapData.contents, filters.withinMiles],
  );
  const events = useMemo(
    () => pickEvents(eventsRead.events, undefined, near.ids),
    [eventsRead.events, near.ids],
  );
  const { organizations: everyOrganization, byId: organizationsById } = useOrganizations();
  const viewer = useViewerEvents(memberId);
  const membersRead = useBrowseMembers();
  const threadsRead = useMyThreads();
  const [writeError, setWriteError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const topics = useMemo(
    () => toHomeTopics(topicRead.topics, topicRead.posts, rooms.rooms),
    [topicRead.topics, topicRead.posts, rooms.rooms],
  );
  // Anybody the viewer has actually spoken with directly. A direct thread
  // nobody has written in is not a conversation, as Chat's own list agrees.
  const talkedTo = useMemo(
    () =>
      new Set(
        threadsRead.threads
          .filter((thread) => thread.kind === 'direct' && thread.lastAt !== null)
          .flatMap((thread) => (thread.otherMemberId ? [thread.otherMemberId] : [])),
      ),
    [threadsRead.threads],
  );
  const people = useMemo(
    () =>
      suggestPeople(
        peersFar
          ? membersRead.members.filter((member) => !peersFar.has(member.id))
          : membersRead.members,
        memberId,
        talkedTo,
        new Date(),
        SEGMENT_PEOPLE,
      ),
    [membersRead.members, peersFar, memberId, talkedTo],
  );

  const authors = useChatAuthors(
    topics.flatMap((topic) => [topic.authorId, topic.firstReply?.authorId ?? null]),
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

  const loading: Record<Source, boolean> = {
    topics: topicRead.loading || rooms.loading,
    events: eventsRead.loading || near.status === 'loading',
    // A failed conversations read is not waited on: a redundant suggestion beats none.
    people:
      membersRead.loading ||
      threadsRead.loading ||
      (filters.withinMiles !== null && mapData.status === 'loading'),
  };
  const errors: Record<Source, string | null> = {
    topics: topicRead.error ?? rooms.error,
    events: eventsRead.error,
    people: membersRead.error,
  };
  const sources: Source[] = SOURCES[segment];
  const settled = sources.every((source) => !loading[source]);
  const failures = sources.flatMap((source) => {
    const error = errors[source];
    return error ? [error] : [];
  });

  const items = useMemo(
    () => inSegment(segment, { topics, events, people }),
    [segment, topics, events, people],
  );
  const filterContext = useMemo<FeedFilterContext>(
    () => ({
      openRooms: openRoomsById(rooms.rooms),
    }),
    [rooms.rooms],
  );
  const shown = useMemo(
    () => items.filter((item) => matchesFeedFilters(item, filters, filterContext)),
    [items, filters, filterContext],
  );
  const filterCount = activeFilterCount(filters) + (segment === 'everything' ? 0 : 1);
  const profile = useProfileAsk(memberId);

  const { saved: rsvpSheetFor, sheet: rsvpSheet } = useRsvpSheet(memberId);
  const onRsvp = useCallback(
    (event: ClubEvent, next: RsvpStatus | null) => {
      if (!memberId) return;
      setWriteError(null);
      void setRsvp(event.id, memberId, next).then((result) => {
        // Re-read rather than patch: the tallies come from the database.
        if (result.ok) {
          viewer.reload();
          eventsRead.reload?.();
          rsvpSheetFor(event, next, (again) => {
            onRsvp(event, again);
          });
        } else setWriteError(result.error ?? 'Could not save that.');
      });
    },
    [memberId, viewer, eventsRead.reload, rsvpSheetFor],
  );

  /** A standing opener's likes, drawn as unknown until they are read. */
  function likesFor(opening: ChatPost | null): CardLikes | undefined {
    if (!opening) return undefined;
    return {
      likedBy: likes.byPost.get(opening.id) ?? [],
      readerId: memberId,
      loading: likes.loadingFor(opening.id),
      unavailable: Boolean(likes.error),
      onToggle: () => {
        likes.toggle(opening.id);
      },
      failure: likes.failure?.postId === opening.id ? likes.failure.message : null,
    };
  }

  function draw(item: FeedItem) {
    switch (item.kind) {
      case 'topic':
        return (
          <TopicCard
            topic={item.topic}
            starter={item.topic.authorId ? (authors.get(item.topic.authorId) ?? null) : null}
            replier={
              item.topic.firstReply?.authorId
                ? (authors.get(item.topic.firstReply.authorId) ?? null)
                : null
            }
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
      case 'event':
        return (
          <EventCard
            event={item.event}
            status={viewer.rsvps.get(item.event.id) ?? null}
            organization={
              item.event.organizationId
                ? (organizationsById.get(item.event.organizationId) ?? null)
                : null
            }
            onOpen={() => {
              void navigate(`/events/${item.event.id}`, { state: linkState });
            }}
            onOpenOrganization={(id) => {
              void navigate(`/events/organizations/${id}`, { state: linkState });
            }}
            onOpenMember={(id) => {
              void navigate(`/peers/${id}`, { state: linkState });
            }}
            onRsvp={(next) => {
              onRsvp(item.event, next);
            }}
          />
        );
      case 'person':
        return <PersonCard member={item.member} linkState={linkState} />;
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {searching ? (
        <HomeSearch
          sources={{
            topics,
            events: eventsRead.events,
            members: membersRead.members.filter((member) => member.id !== memberId),
            organizations: everyOrganization,
          }}
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
              its picker card. Not on Events (the owner, 2026-10-10): it read as an event. */}
          {segment === 'photos' ? (
            <ComposeCard segment={segment} linkState={linkState} />
          ) : segment === 'events' ? null : (
            <QuickAsk rooms={rooms.rooms} linkState={linkState} className="mb-[11px]" />
          )}
          {writeError ? <Problem sentences={[writeError]} /> : null}

          {!settled ? (
            <LoadingCards label="Loading…" height={170} />
          ) : (
            <>
              {failures.length > 0 ? <Problem sentences={failures} /> : null}
              {shown.length > 0 ? (
                <>
                  <ul className="arrive">
                    {shown.map((item, index) => (
                      // An event card carries its own bottom margin; the
                      // others are given the same one here.
                      <Fragment key={item.key}>
                        <li className={item.kind === 'event' ? '' : 'mb-[11px]'}>{draw(item)}</li>
                        {/* Below the first card (the owner, 2026-10-28): what
                            members think of the app. Not on the Events pill. */}
                        {index === 0 && segment !== 'events' ? (
                          <FeedbackCard
                            rooms={rooms.rooms}
                            linkState={linkState}
                            className="mb-[11px]"
                          />
                        ) : null}
                        {/* Sixth (the owner, 2026-11-01), or last in a shorter feed. */}
                        {profile.ask &&
                        segment !== 'events' &&
                        index === Math.min(4, shown.length - 1) ? (
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
                <EmptyList segment={segment} />
              )}
            </>
          )}
        </div>
      </div>

      {sheetOpen ? (
        <HomeFilterSheet
          chips={chipsFor(items, filters, filterContext)}
          home={{ city: home?.city ?? null, status: near.status }}
          segments={SEGMENTS}
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
      {rsvpSheet}
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
function EmptyList({ segment }: { segment: HomeSegment }) {
  const empty: Record<HomeSegment, [string, [string, string] | null]> = {
    everything: ['Nothing here yet.', null],
    questions: [
      'No questions yet. Ask one above: no question is too basic.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    topics: [
      'No topics yet. Rooms open a few at a time, and anybody can start one.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    photos: [
      'No photographs yet. A topic with a photograph shows up here.',
      ['/chat?segment=rooms', 'See the rooms'],
    ],
    events: [
      'Nothing on the calendar near you in the next 30 days.',
      ['/events', 'See the whole calendar'],
    ],
    people: ['Nobody new to suggest today.', ['/peers', 'See everyone in Peers']],
  };
  const [sentence, link] = empty[segment];
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
