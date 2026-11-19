import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CardsShown } from '@/components/cards-shown';
import { FilterButton } from '@/components/filter-button';
import { HeaderSearch } from '@/components/header-search';
import { LoadingCards } from '@/components/loading-cards';
import { useRsvpSheet } from '@/components/rsvp-sheet';
import { TwoWayToggle } from '@/components/two-way-toggle';
import { useAccount } from '@/lib/account';
import { isEventOver } from '@/lib/event-over';
import { setRsvp, useEvents, useViewerEvents } from '@/lib/events';
import { useFilterPlace } from '@/lib/filter-place';
import { useHome } from '@/lib/home-state';
import { useMapData } from '@/lib/map-data';
import { useNearHome } from '@/lib/near-home';
import { useOrganizationFollows } from '@/lib/organization-follows';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { useSession } from '@/lib/session';
import { EventCard } from '@/routes/events/event-card';
import { mayAddEvents } from '@/routes/events/event-draft';
import { EventFilterSheet } from '@/routes/events/filter-sheet';
import {
  activeFilterCount,
  dateWindowRange,
  filterEvents,
  isPastEvent,
  isRsvpSegment,
  matchesEventSearch,
  organizationIdsIn,
  tagsIn,
} from '@/routes/events/filters';
import { OrganizationFilterSheet } from '@/routes/events/organization-filter-sheet';
import {
  type DirectoryFilters,
  directoryFilterCount,
  NO_FILTERS,
  OrganizationList,
  useDirectory,
} from '@/routes/events/organization-list';
import { EventScheduleUpdates } from '@/routes/events/schedule-updates';
import { SeriesFooter } from '@/routes/events/series-card';
import { groupBySeries } from '@/routes/events/series-groups';
import { type MapProblem, MapProblemNote, MapView } from '@/routes/map/map-view';
import { canShowOnMap, mapLinkFor, SHOW_PARAM } from '@/routes/map/show-on-map';
import { useListOrMap, ViewSwitch } from '@/routes/map/view-switch';
import { milesForEnough, organizationMiles, organizationsWithin } from '@/routes/peers/filters';
import {
  type ClubEvent,
  DEFAULT_WITHIN_MILES,
  EMPTY_EVENT_FILTERS,
  EVENT_FORMATS,
  EVENTS_SEGMENTS,
  type EventFilters,
  type EventsSegment,
  type Organization,
  type RsvpStatus,
} from '@/types/domain';

/**
 * Events — what there is to go to, from the partner organizations' own
 * calendars.
 *
 * ---------------------------------------------------------------------------
 * Why this is a column and not the full shell
 * ---------------------------------------------------------------------------
 * Peers grids its cards into the shell's full width, because a deck is
 * something you scan. A calendar is something you read down: one event after
 * another in date order, and the order is the content. Stretched to 1100px
 * every card's title, chips, host and buttons sit at wildly different x
 * positions, so following the list means sweeping the eye — and every RSVP
 * means dragging the pointer — right across the screen.
 *
 * That cost is not evenly shared. A member with a cervical injury may be
 * driving this with a head pointer, a mouth stick or a trackball, where
 * distance is effort rather than a flick of the wrist. So the column is capped
 * at a comfortable reading measure: wider than the phone, nowhere near the
 * window, and the same shape on every screen.
 *
 * Most events here were published by somebody else and ingested
 * (jobs/event-ingest). From 2026-10-05 an administrator, or a member who
 * speaks for an organization, can also add one by hand (event-form.tsx). Every
 * member can ask to add an organization, so the + is for everybody.
 *
 * The segments are the mock's, from `evPage()`. Organizations is the odd one:
 * it is not a narrowing of the list but a different body entirely, because the
 * mock treats the directory of organizations as part of this tab rather than as
 * a tab of its own.
 *
 * The header is two rows, to leave the screen to the list or the map (the
 * owner, 2026-11-01): what to look at and how, then search, filters and +.
 */

/**
 * A toggle: the calendar and the organizations (the owner, 2026-10-10).
 *
 * There were seven. Going, Interested and Been to are the member's own RSVPs,
 * and are now "Your RSVP" in Filters, beside the other ways of narrowing the
 * list; Adaptive sport and Online were narrowings the sheet already had (the
 * Sport tags, and "Getting there"). The URL still names the RSVP list, so
 * Me's counters link straight to it.
 */
type EventsPill = 'events' | 'orgs';
const PILLS = [
  ['events', 'Events'],
  ['orgs', 'Organizations'],
] as const satisfies readonly (readonly [EventsPill, string])[];

/** The RSVP lists, by the words Filters and the "Showing" line use. */
const RSVP_LABELS: Record<'going' | 'interested' | 'been-to', string> = {
  going: "I'm going",
  interested: 'Interested',
  'been-to': 'Been to',
};

export default function EventsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const memberId = session.status === 'signed-in' ? session.userId : null;

  const { organizations, byId: organizationsById } = useOrganizations();
  const follows = useOrganizationFollows();
  const viewer = useViewerEvents(memberId);
  const account = useAccount();
  const mine = useMyOrganizations(memberId);
  const canAddEvents = account.status === 'member' && mayAddEvents(account.isAdmin, mine.ids);

  // The segment lives in the URL, not in component state. Opening an
  // organization and pressing back used to land on Upcoming, because the state
  // died with the unmounted page — and a back arrow that does not go back is
  // worse than no back arrow. It also makes a segment linkable and survives a
  // refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('segment');
  // Adaptive sport and Online are no longer lists of their own (see PILLS);
  // an old link to one opens the whole calendar.
  const segment: EventsSegment =
    EVENTS_SEGMENTS.includes(fromUrl as EventsSegment) &&
    fromUrl !== 'sport' &&
    fromUrl !== 'online'
      ? (fromUrl as EventsSegment)
      : 'upcoming';
  const setSegment = useCallback(
    (next: EventsSegment) => {
      // Replace rather than push: the segment pills are a filter, and tapping
      // through four of them should not mean four presses of back to leave.
      setSearchParams(
        (current) => {
          const kept = new URLSearchParams();
          if (next !== 'upcoming') kept.set('segment', next);
          if (current.get('view') === 'map') kept.set('view', 'map');
          return kept;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // The map, once opened, stays mounted and is hidden for the list.
  const [view, setView] = useListOrMap('/events');
  // "View on the map": the event to open the map on, until the map has done it.
  const showId = view === 'map' ? searchParams.get(SHOW_PARAM) : null;
  const [readShown, setReadShown] = useState<{ id: string; event: ClubEvent | null } | null>(null);
  const clearShow = useCallback(() => {
    setSearchParams(
      (current) => {
        current.delete(SHOW_PARAM);
        return current;
      },
      { replace: true },
    );
  }, [setSearchParams]);
  const [mapOpened, setMapOpened] = useState(view === 'map');
  if (view === 'map' && !mapOpened) setMapOpened(true);
  const [mapProblem, setMapProblem] = useState<MapProblem | null>(null);
  const showingMap = view === 'map' && !mapProblem;
  // The directory's filters, held here so its list and the map agree.
  const [directory, setDirectory] = useState<DirectoryFilters>(NO_FILTERS);
  const [mapOrganizations, setMapOrganizations] = useState<Organization[] | null>(null);
  const [directorySheetOpen, setDirectorySheetOpen] = useState(false);
  const [filters, setFilters] = useState<EventFilters>(EMPTY_EVENT_FILTERS);
  const [eventSearch, setEventSearch] = useState('');
  // A search looks through everything (the owner, 2026-11-01): no filter, no
  // distance and no dates hide what somebody typed the name of.
  const searching = eventSearch.trim() !== '';
  // Been to is bounded by its ids, so an event over earlier today is in it.
  const dateRange =
    segment === 'been-to'
      ? null
      : dateWindowRange(isRsvpSegment(segment) || searching ? 'any' : filters.when);
  // Been to is the member's own past RSVPs: read those, not every past event.
  const beenTo = useMemo(
    () =>
      segment !== 'been-to'
        ? undefined
        : viewer.loading
          ? null
          : [...viewer.rsvps.keys()].filter((eventId) => {
              const when = viewer.whens.get(eventId);
              return when === undefined || isEventOver(when);
            }),
    [segment, viewer.loading, viewer.rsvps, viewer.whens],
  );
  const { events, loading, error, reload } = useEvents({
    ...(dateRange ?? {}),
    ...(beenTo === undefined ? {} : { ids: beenTo }),
  });
  // Every coming date the member is going to, read by itself (the owner,
  // 2026-11-18: "I am not seeing events I am going to by default"). Read with
  // the calendar, one more than 30 days off or 50 miles away was not there to
  // put on top: only a search, which lifts both, found it.
  const goingIds = useMemo(
    () =>
      segment !== 'upcoming'
        ? []
        : viewer.loading
          ? null
          : [...viewer.rsvps]
              .filter(([eventId, answer]) => {
                if (answer !== 'going') return false;
                const when = viewer.whens.get(eventId);
                return when === undefined || !isEventOver(when);
              })
              .map(([eventId]) => eventId),
    [segment, viewer.loading, viewer.rsvps, viewer.whens],
  );
  const goingRead = useEvents({ ids: goingIds });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const home = useHome();
  // Organizations start at the distance with at least 20 in it (the owner,
  // 2026-11-01), until the member chooses for themselves. One with no place on
  // the map, a national funder say, always shows.
  const directoryMap = useMapData(segment === 'orgs');
  const milesAtStart = useMemo(
    () => milesForEnough(directoryMap.contents.home, directoryMap.contents.organizations),
    [directoryMap.contents],
  );
  const chosenMiles = useRef(false);
  useEffect(() => {
    if (chosenMiles.current) return;
    setDirectory((now) =>
      now.withinMiles === milesAtStart ? now : { ...now, withinMiles: milesAtStart },
    );
  }, [milesAtStart]);
  // From a place the member chose instead of home (filter-place.ts).
  const place = useFilterPlace();
  const organizationsNear = useMemo(() => {
    const miles = directory.withinMiles;
    const home = place ?? directoryMap.contents.home;
    // A search looks through all of them, wherever they are.
    if (miles === null || directory.query.trim() || !home) {
      return organizations;
    }
    const placed = new Set(directoryMap.contents.organizations.map((spot) => spot.id));
    const near = organizationsWithin({ ...directoryMap.contents, home }, miles);
    return organizations.filter(({ id }) => !placed.has(id) || near.has(id));
  }, [organizations, directory.withinMiles, directory.query, directoryMap.contents, place]);
  // Nearest first, from the same place the distance is measured from.
  const milesAway = useMemo(
    () =>
      organizationMiles({ ...directoryMap.contents, home: place ?? directoryMap.contents.home }),
    [directoryMap.contents, place],
  );
  const changeDirectory = (next: DirectoryFilters) => {
    chosenMiles.current = next.withinMiles !== milesAtStart;
    setDirectory(next);
  };
  const near = useNearHome(filters.withinMiles);
  const hostTypes = useMemo(
    () =>
      new Map(
        organizations.flatMap((organization) =>
          organization.category ? [[organization.id, organization.category] as const] : [],
        ),
      ),
    [organizations],
  );
  const viewerState = useMemo(
    () => ({ rsvps: viewer.rsvps, nearby: near.ids, hostTypes }),
    [viewer.rsvps, near.ids, hostTypes],
  );

  const searched = useCallback(
    (list: ClubEvent[]) =>
      list.filter((event) =>
        matchesEventSearch(
          event,
          eventSearch,
          // The lead host and its co-hosts, so either name finds it.
          [event.organizationId, ...event.cohostIds]
            .map((id) => (id ? organizationsById.get(id)?.name : undefined))
            .filter(Boolean)
            .join(' ') || undefined,
        ),
      ),
    [eventSearch, organizationsById],
  );
  const narrowing = useMemo<EventFilters>(
    () => (searching ? { ...EMPTY_EVENT_FILTERS, when: 'any', withinMiles: null } : filters),
    [searching, filters],
  );
  const visible = useMemo(
    () => searched(filterEvents(events, narrowing, segment, viewerState)),
    [events, narrowing, segment, viewerState, searched],
  );
  // Distance is the list's (the owner, 2026-10-31): the map shows every place.
  const onMap = useMemo(
    () => searched(filterEvents(events, { ...narrowing, withinMiles: null }, segment, viewerState)),
    [events, narrowing, segment, viewerState, searched],
  );

  // Grouped only in the browsing segments. "I'm going", "Interested" and
  // "Been to" are lists of particular dates a member chose, and collapsing the
  // three Fridays they said yes to into one row would hide the answer they came
  // for.
  const grouped = useMemo(() => {
    if (isRsvpSegment(segment)) {
      return visible.map((event) => ({ lead: event, rest: [], seriesId: event.seriesId }));
    }
    return groupBySeries(visible);
  }, [visible, segment]);
  // What the member is going to, on top of the calendar (the owner,
  // 2026-11-03), each date by itself as in "I'm going", then the rest grouped.
  // Its own dates, wherever and whenever they are: a filter narrows the rest.
  const goingFirst = useMemo(() => {
    if (segment !== 'upcoming') return null;
    // The calendar's own too, so a date answered just now stays up while
    // the read of them all lands.
    const byId = new Map(
      [...(searching ? searched(goingRead.events) : goingRead.events), ...visible].map((event) => [
        event.id,
        event,
      ]),
    );
    const going = [...byId.values()]
      .filter((event) => viewer.rsvps.get(event.id) === 'going' && !isPastEvent(event))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (going.length === 0) return null;
    const ids = new Set(going.map((event) => event.id));
    return {
      going: going.map((event) => ({ lead: event, rest: [], seriesId: event.seriesId })),
      rest: groupBySeries(visible.filter((event) => !ids.has(event.id))),
    };
  }, [visible, segment, viewer.rsvps, goingRead.events, searching, searched]);

  // Which series are open, by series id. Reset when the segment or the window
  // changes: an expansion is about the list in front of you, and leaving it
  // open across a filter change reopens a group whose dates are now different.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const filterKey = `${segment}|${filters.when}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setExpanded(new Set());
  }

  const toggleSeries = useCallback((seriesId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(seriesId)) next.add(seriesId);
      return next;
    });
  }, []);

  // The sheet's options come from the events the segment and the date window
  // have already selected, not from the whole calendar: a chip offered while
  // "Online" is on should narrow the online events, and a city chip offered
  // while the window says "Next 7 days" should be a city with an event in the next
  // seven. The other narrowing filters are deliberately *not* applied — they are
  // what the sheet is for, and dropping them means picking one city does not
  // make every other city vanish from the list you picked it from.
  const inSegment = useMemo(
    () =>
      filterEvents(
        events,
        {
          ...EMPTY_EVENT_FILTERS,
          when: filters.when,
          withinMiles: showingMap ? null : filters.withinMiles,
        },
        segment,
        viewerState,
      ),
    [events, segment, viewerState, filters.when, filters.withinMiles, showingMap],
  );

  const hostingOrganizations = useMemo(() => {
    const hosting = organizationIdsIn(inSegment);
    return organizations.filter((organization) => hosting.has(organization.id));
  }, [organizations, inSegment]);

  const { saved: rsvpSheetFor, sheet: rsvpSheet } = useRsvpSheet(memberId);
  const onRsvp = useCallback(
    (event: ClubEvent, next: RsvpStatus | null) => {
      if (!memberId) return;
      setWriteError(null);
      void setRsvp(event.id, memberId, next).then((result) => {
        // Re-read rather than patching local state: the tallies on every card
        // come from the database, and a local edit would leave the number and
        // the button disagreeing until the next load.
        if (result.ok) {
          viewer.reload();
          reload?.();
          rsvpSheetFor(event, next, (again) => {
            onRsvp(event, again);
          });
        } else setWriteError(result.error ?? 'Could not save that.');
      });
    },
    [memberId, viewer, reload, rsvpSheetFor],
  );

  // The RSVP choice lives in the URL (as the segment) but is one of the
  // filters, so it counts towards the dot.
  const rsvp = isRsvpSegment(segment) ? (segment as keyof typeof RSVP_LABELS) : null;
  const filterCount =
    activeFilterCount(showingMap ? { ...filters, withinMiles: DEFAULT_WITHIN_MILES } : filters) +
    (rsvp ? 1 : 0);
  const showingList = segment !== 'orgs';
  // The search box says its own words; this is the filters behind the circle.
  const headerFilterCount = showingList
    ? filterCount
    : directoryFilterCount(
        {
          ...directory,
          query: '',
          ...(showingMap ? { withinMiles: milesAtStart } : {}),
        },
        milesAtStart,
      );

  // The event "View on the map" asked for: from the list, or read by itself
  // when the filters leave it out (it is shown anyway).
  const listed = showId ? events.find((event) => event.id === showId) : undefined;
  const show = !showId
    ? undefined
    : listed
      ? { id: showId, event: listed, ready: true }
      : readShown?.id === showId
        ? { id: showId, event: readShown.event, ready: true }
        : { id: showId, event: null, ready: false };

  // An event in a sheet on the map, as the list draws it.
  const mapCard = (event: ClubEvent) => (
    <EventCard
      event={event}
      past={isPastEvent(event)}
      status={viewer.rsvps.get(event.id) ?? null}
      organization={
        event.organizationId ? (organizationsById.get(event.organizationId) ?? null) : null
      }
      onOpen={() => {
        void navigate(`/events/${event.id}`, { state: { segment, view: 'map' } });
      }}
      onOpenOrganization={(id) => {
        void navigate(`/events/organizations/${id}`, { state: { segment, view: 'map' } });
      }}
      onOpenMember={(id) => {
        void navigate(`/peers/${id}`, { state: { segment, view: 'map' } });
      }}
      onRsvp={(next) => {
        onRsvp(event, next);
      }}
    />
  );

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-2.5">
        <h1 className="sr-only">Events</h1>
        {/* Wraps rather than cutting List and Map off a small phone at a larger
            text size; they keep to the right (the owner, 2026-11-06). */}
        <div className="mx-auto flex w-full max-w-[var(--events-measure)] flex-wrap items-center justify-between gap-2">
          <TwoWayToggle
            label="Show"
            options={PILLS}
            value={segment === 'orgs' ? 'orgs' : 'events'}
            onChange={(next) => {
              setSegment(next === 'orgs' ? 'orgs' : 'upcoming');
            }}
          />
          {/* On a computer, in the bar between the switches, for what is
              showing (the owner, 2026-11-03); a phone has the round + over the
              list instead. */}
          {account.status === 'member' && (canAddEvents || !showingList) ? (
            <Link
              to={showingList ? '/events/new' : '/events/new?add=organization'}
              className="hidden min-h-[38px] items-center gap-1.5 rounded-full bg-tint px-3.5 font-semibold text-[0.84375rem] text-emphasis transition-colors hover:bg-line md:flex"
              data-target="small"
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={2.4} aria-hidden="true" />
              {showingList ? 'Event' : 'Organization'}
            </Link>
          ) : null}
          <ViewSwitch view={view} onChange={setView} className="ml-auto" />
        </div>

        <div className="mx-auto flex w-full max-w-[var(--events-measure)] items-center gap-2 py-2">
          <HeaderSearch
            label={showingList ? 'Search events' : 'Search organizations'}
            value={showingList ? eventSearch : directory.query}
            onChange={(next) => {
              if (showingList) setEventSearch(next);
              else setDirectory({ ...directory, query: next });
            }}
          />
          <FilterButton
            count={headerFilterCount}
            onClick={() => {
              if (showingList) setSheetOpen(true);
              else setDirectorySheetOpen(true);
            }}
          />
        </div>
        {/* Said, so a narrowed list is never mistaken for the calendar. */}
        {rsvp ? (
          <p className="mx-auto flex w-full max-w-[var(--events-measure)] flex-wrap items-center gap-x-2 pb-2.5 text-[0.8125rem] text-ink2">
            <span>
              Showing: <span className="font-bold text-ink">{RSVP_LABELS[rsvp]}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSegment('upcoming');
              }}
              className="min-h-[36px] font-semibold text-emphasis underline underline-offset-2"
              data-target="small"
            >
              Show all events
            </button>
          </p>
        ) : null}
      </header>

      {mapOpened ? (
        <>
          {/* Distance is the list's here too (the owner, 2026-11-03). */}
          <DirectoryShown
            organizations={organizations}
            events={events}
            following={follows.following}
            filters={directory}
            onShown={setMapOrganizations}
          />
          {showId && !listed && !loading ? (
            <ShownEventRead id={showId} onRead={setReadShown} />
          ) : null}
          <MapView
            hidden={!showingMap}
            {...(show ? { show, onShown: clearShow } : {})}
            onProblem={setMapProblem}
            focus={segment === 'orgs' ? 'organizations' : 'events'}
            events={onMap}
            {...(mapOrganizations ? { organizations: mapOrganizations } : {})}
            types={{
              hidden: directory.hiddenTypes,
              onChange: (hiddenTypes) => {
                setDirectory((now) => ({ ...now, hiddenTypes }));
              },
            }}
            renderEvent={mapCard}
            // The map holds what is still to come (map_events).
            eventsNote={
              segment === 'been-to' || (!rsvp && filters.when === 'past')
                ? 'The map shows upcoming events only. Past ones are in the list.'
                : undefined
            }
            backState={{ segment, view: 'map' }}
          />
        </>
      ) : null}

      {/* Floating, away from the header's search and filter, and on the lists
          only: the map keeps its corner for its own buttons (the owner,
          2026-11-01). */}
      {account.status === 'member' && !showingMap ? (
        <Link
          to={canAddEvents && showingList ? '/events/new' : '/events/new?add=organization'}
          aria-label="Add"
          className="absolute right-4 bottom-4 z-10 grid md:hidden h-14 w-14 place-items-center rounded-full bg-action text-white shadow-[0_6px_18px_rgba(10,20,35,.35)] transition-colors hover:bg-action-hi"
        >
          <Plus className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : null}

      <div
        hidden={showingMap}
        className="flex-1 overflow-y-auto px-4 pt-3.5 pb-[88px] md:px-6 md:pb-6"
      >
        <div className="mx-auto w-full max-w-[var(--events-measure)]">
          {segment !== 'orgs' ? <EventScheduleUpdates memberId={memberId} /> : null}
          {view === 'map' && mapProblem ? <MapProblemNote problem={mapProblem} /> : null}
          {writeError ? (
            <p className="mb-2.5 rounded-xl bg-danger-lt px-3.5 py-2.5 text-[0.7875rem] text-danger-ink">
              {writeError}
            </p>
          ) : null}

          {segment === 'orgs' ? (
            <OrganizationList
              organizations={organizationsNear}
              events={events}
              following={follows.following}
              requested={follows.requested}
              onToggleFollow={follows.toggle}
              filters={directory}
              onFiltersChange={changeDirectory}
              milesAway={milesAway}
              onOpen={(id) => {
                void navigate(`/events/organizations/${id}`, { state: { segment } });
              }}
            />
          ) : loading || (near.status === 'loading' && !rsvp) ? (
            <LoadingCards label="Loading events…" count={4} height={120} />
          ) : error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[0.875rem] text-ink2 leading-relaxed">Could not load events.</p>
              <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
            </div>
          ) : (
            <div className="arrive">
              {/* Timed for page speed, in the list only (the owner, 2026-11-04). */}
              {showingMap ? null : <CardsShown />}
              {(goingFirst
                ? [
                    { heading: "You're going" },
                    ...goingFirst.going,
                    ...(goingFirst.rest.length > 0 ? [{ heading: 'Everything else' }] : []),
                    ...goingFirst.rest,
                  ]
                : grouped
              ).map((group) => {
                if ('heading' in group) {
                  return (
                    <h2
                      key={group.heading}
                      className="mt-1 mb-2 font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]"
                    >
                      {group.heading}
                    </h2>
                  );
                }
                const isOpen = group.seriesId !== null && expanded.has(group.seriesId);
                const hasMore = group.rest.length > 0;
                const card = (event: ClubEvent, asLine: boolean) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    past={!asLine && isPastEvent(event)}
                    occurrence={asLine}
                    attached={asLine}
                    footer={
                      !asLine && hasMore && group.seriesId ? (
                        <SeriesFooter
                          group={group}
                          expanded={isOpen}
                          onToggle={() => {
                            if (group.seriesId) toggleSeries(group.seriesId);
                          }}
                        />
                      ) : undefined
                    }
                    status={viewer.rsvps.get(event.id) ?? null}
                    mapHref={
                      !asLine && canShowOnMap(event) ? mapLinkFor(event.id, segment) : undefined
                    }
                    organization={
                      event.organizationId
                        ? (organizationsById.get(event.organizationId) ?? null)
                        : null
                    }
                    onOpen={() => {
                      void navigate(`/events/${event.id}`, { state: { segment } });
                    }}
                    onOpenOrganization={(id) => {
                      void navigate(`/events/organizations/${id}`, { state: { segment } });
                    }}
                    onOpenMember={(id) => {
                      void navigate(`/peers/${id}`, { state: { segment } });
                    }}
                    onRsvp={(next) => {
                      onRsvp(event, next);
                    }}
                  />
                );

                return (
                  <div key={group.lead.id} className="mb-[11px]">
                    {card(group.lead, false)}
                    {/* The other dates as lines, the same shape a past event
                        takes: the title and host are already above, so what is
                        left to read is when. Each keeps its own RSVP through
                        its own detail page. */}
                    {isOpen ? (
                      // Indented, so a bare date reads as another date of the
                      // card above rather than as an event of its own.
                      <div className="mt-1 pl-3">
                        {group.rest.map((event) => card(event, true))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {visible.length === 0 && !goingFirst ? <EmptyList segment={segment} /> : null}
            </div>
          )}
        </div>
      </div>

      {directorySheetOpen ? (
        <OrganizationFilterSheet
          organizations={showingMap ? organizations : organizationsNear}
          distance={!showingMap}
          home={{
            city: home?.city ?? null,
            status:
              directoryMap.status === 'loading'
                ? 'loading'
                : place || directoryMap.contents.home
                  ? 'ready'
                  : 'unplaced',
          }}
          startingMiles={milesAtStart}
          events={events}
          following={follows.following}
          filters={directory}
          onChange={changeDirectory}
          onClose={() => {
            setDirectorySheetOpen(false);
          }}
        />
      ) : null}
      {sheetOpen && (showingList || showingMap) ? (
        <EventFilterSheet
          tags={tagsIn(inSegment)}
          // Online-only events are never on the map.
          // All three, always (the owner, 2026-11-03).
          formats={EVENT_FORMATS.filter((format) => !showingMap || format !== 'online')}
          organizations={hostingOrganizations}
          following={follows.following}
          home={{ city: home?.city ?? null, status: near.status }}
          filters={filters}
          rsvp={rsvp}
          distance={!showingMap}
          onRsvpChange={(next) => {
            setSegment(next ?? 'upcoming');
          }}
          matchCount={showingMap ? onMap.length : visible.length}
          activeCount={filterCount}
          onChange={setFilters}
          onClear={() => {
            setFilters(EMPTY_EVENT_FILTERS);
            setSegment('upcoming');
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

/** One event by itself, for "View on the map" when the list does not hold it. */
function ShownEventRead({
  id,
  onRead,
}: {
  id: string;
  onRead: (read: { id: string; event: ClubEvent | null }) => void;
}) {
  const { events, loading } = useEvents({ id });
  useEffect(() => {
    if (!loading) onRead({ id, event: events[0] ?? null });
  }, [id, events, loading, onRead]);
  return null;
}

/** The directory as its filters leave it, for the map; read only once the map is opened. */
function DirectoryShown({
  organizations,
  events,
  following,
  filters,
  onShown,
}: {
  organizations: Organization[];
  events: ClubEvent[];
  following: ReadonlySet<string>;
  filters: DirectoryFilters;
  onShown: (shown: Organization[]) => void;
}) {
  const { shown } = useDirectory(organizations, events, following, filters);
  // Only a different list: a new array of the same ones would draw the map again.
  const key = shown.map((organization) => organization.id).join(',');
  const latest = useRef(shown);
  latest.current = shown;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the list's contents.
  useEffect(() => {
    onShown(latest.current);
  }, [key, onShown]);
  return null;
}

/**
 * Empty states say which emptiness this is.
 *
 * "Nothing here yet" under "I'm going" is a different sentence from the same
 * words under a filtered calendar: one means you have not said yes to anything,
 * the other means the filters are too narrow. Telling somebody to widen filters
 * they never set is how an app teaches people to distrust it.
 */
function EmptyList({ segment }: { segment: EventsSegment }) {
  if (segment === 'going') {
    return (
      <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
        You have not said you are going to anything yet.
        <br />
        Events you say yes to show up here.
      </p>
    );
  }
  if (segment === 'been-to') {
    return (
      <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
        Nothing here yet.
        <br />
        Events you said you were going to appear here once they have happened.
      </p>
    );
  }
  if (segment === 'interested') {
    // Its own sentence rather than "nothing matches that": an empty Interested
    // is not a filter that found nothing, it is a question nobody has answered
    // yet, and the two read very differently to somebody new.
    return (
      <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
        Nothing marked interested yet.
        <br />
        Tap Interested on an event to keep it here while you decide.
      </p>
    );
  }
  return (
    <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
      Nothing on the calendar for that.
      <br />
      Try a wider distance or date range, or fewer filters.
    </p>
  );
}
