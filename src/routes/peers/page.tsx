import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardsShown } from '@/components/cards-shown';
import { FilterButton } from '@/components/filter-button';
import { HeaderSearch } from '@/components/header-search';
import { LoadingCards } from '@/components/loading-cards';
import { TwoWayToggle } from '@/components/two-way-toggle';
import { useFilterPlace } from '@/lib/filter-place';
import { useHome } from '@/lib/home-state';
import { useMapData } from '@/lib/map-data';
import { useBrowseMembers } from '@/lib/members';
import type { NearHomeStatus } from '@/lib/near-home';
import { useSession } from '@/lib/session';
import { type MapProblem, MapProblemNote, MapView } from '@/routes/map/map-view';
import { useListOrMap, ViewSwitch } from '@/routes/map/view-switch';
import { FilterSheet } from '@/routes/peers/filter-sheet';
import {
  activeFilterCount,
  ageBandsIn,
  filterMembers,
  hasConditions,
  memberPlaces,
  membersBeyond,
  milesForEnough,
  organizationsIn,
  othersOnly,
  regionsIn,
  topicsIn,
} from '@/routes/peers/filters';
import { MemberCard } from '@/routes/peers/member-card';
import { rankMembers } from '@/routes/peers/ranking';
import {
  inEdgeGuard,
  nextSegment,
  startsInHorizontalScroller,
  swipeDirection,
} from '@/routes/peers/swipe';
import { EMPTY_MEMBER_FILTERS, type MemberFilters, type PeersSegment } from '@/types/domain';

/**
 * Peers — the deck of members, and the first thing somebody sees after joining.
 *
 * Everyone / Mentors are segment pills rather than separate tabs,
 * because at this card size a segment is a change of content and nothing else.
 * Horizontal swipe does the same thing as the pills; it is an accelerator and
 * never the only way through, because switch control, keyboard and VoiceOver
 * users cannot reliably swipe.
 */

const SEGMENTS = [
  ['everyone', 'Peers'],
  ['mentors', 'Mentors'],
] as const;

export default function PeersPage() {
  const navigate = useNavigate();
  const { members, loading, error, signedOut } = useBrowseMembers();
  const session = useSession();
  const memberId = session.status === 'signed-in' ? session.userId : null;
  const [segment, setSegment] = useState<PeersSegment>('everyone');
  const [filters, setFilters] = useState<MemberFilters>(EMPTY_MEMBER_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The map, once opened, stays mounted and is hidden for the list.
  const [view, setView] = useListOrMap('/peers');
  const [mapOpened, setMapOpened] = useState(view === 'map');
  if (view === 'map' && !mapOpened) setMapOpened(true);
  const [mapProblem, setMapProblem] = useState<MapProblem | null>(null);
  const showingMap = view === 'map' && !mapProblem;

  const deckRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; target: Element | null } | null>(null);

  // No viewer yet — the signed-in member's own row arrives with onboarding.
  // rankMembers keeps the incoming order when the viewer is null.
  const viewer = null;

  // Filtered once, before both the deck and the count below it, so the two
  // cannot disagree about who is in it.
  const others = useMemo(() => othersOnly(members, memberId), [members, memberId]);

  // The map's own data: distances, and where the map first zooms to. The
  // list starts at any distance (the owner, 2026-11-10: a friend 30 minutes
  // away was left out of a small club).
  const home = useHome();
  const mapData = useMapData();
  const mapZoomMiles = useMemo(
    () => milesForEnough(mapData.contents.home, memberPlaces(mapData.contents, memberId)),
    [mapData.contents, memberId],
  );
  // From a place the member chose instead of home (filter-place.ts).
  const place = useFilterPlace();
  const far = useMemo(
    () =>
      membersBeyond(
        place ? { ...mapData.contents, home: place } : mapData.contents,
        filters.withinMiles,
      ),
    [mapData.contents, filters.withinMiles, place],
  );
  const distanceStatus: NearHomeStatus =
    filters.withinMiles === null
      ? 'any'
      : mapData.status === 'error'
        ? 'error'
        : mapData.status === 'loading'
          ? 'loading'
          : place || mapData.contents.home
            ? 'ready'
            : 'unplaced';

  const visible = useMemo(
    () => rankMembers(filterMembers(others, filters, segment, far), viewer),
    [others, filters, segment, far],
  );
  // Distance is the list's (the owner, 2026-11-03): the map shows everybody.
  const onMap = useMemo(
    () => filterMembers(others, { ...filters, withinMiles: null }, segment),
    [others, filters, segment],
  );
  // Those in the list as it stands without this choice, so it never offers nobody.
  const organizations = useMemo(
    () => organizationsIn(filterMembers(others, { ...filters, organization: null }, segment, far)),
    [others, filters, segment, far],
  );

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || inEdgeGuard(touch.clientX)) {
      dragStart.current = null;
      return;
    }
    dragStart.current = { x: touch.clientX, y: touch.clientY, target: e.target as Element };
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;

    const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (!direction) return;
    if (startsInHorizontalScroller(start.target, deckRef.current, direction)) return;

    setSegment((current) => nextSegment(current, direction));
  }, []);

  const filterCount = activeFilterCount(showingMap ? { ...filters, withinMiles: null } : filters);
  const totalInSegment = filterMembers(others, EMPTY_MEMBER_FILTERS, segment).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* As Events (the owner, 2026-11-01). Peers is everybody, mentors too;
          Mentors narrows to them. The search reads across name, place, level,
          topics, interests and the bio. */}
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-2.5">
        <h1 className="sr-only">Peers</h1>
        {/* Wraps rather than cutting List and Map off a small phone at a larger
            text size; they keep to the right (the owner, 2026-11-06). */}
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2">
          <TwoWayToggle label="Show" options={SEGMENTS} value={segment} onChange={setSegment} />
          <ViewSwitch view={view} onChange={setView} className="ml-auto" />
        </div>
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-2 py-2">
          <HeaderSearch
            label="Search members by name"
            placeholder="Search by name"
            value={filters.search}
            onChange={(search) => {
              setFilters((f) => ({ ...f, search }));
            }}
          />
          <FilterButton
            count={filterCount}
            onClick={() => {
              setSheetOpen(true);
            }}
          />
        </div>
      </header>

      {mapOpened ? (
        <MapView
          hidden={!showingMap}
          onProblem={setMapProblem}
          focus="peers"
          members={onMap}
          zoomToMiles={mapZoomMiles}
          backState={{ from: 'peers-map' }}
        />
      ) : null}

      <div
        ref={deckRef}
        hidden={showingMap}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="flex-1 overflow-y-auto px-4 pt-3.5 pb-[18px] md:px-6"
      >
        {view === 'map' && mapProblem ? (
          <div className="mx-auto w-full max-w-[1100px]">
            <MapProblemNote problem={mapProblem} />
          </div>
        ) : null}
        {loading ? (
          <LoadingCards label="Loading members…" count={2} height={360} />
        ) : signedOut ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[0.875rem] text-ink2 leading-relaxed">
              The club is members only. Sign in to see who is here.
            </p>
            <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">
              Nothing inside the club is public.
            </p>
          </div>
        ) : error ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[0.875rem] text-ink2 leading-relaxed">Could not load members.</p>
            <p className="mt-2 text-[0.78125rem] text-grey leading-relaxed">{error}</p>
          </div>
        ) : (
          <>
            {/* Timed for page speed, in the deck only (the owner, 2026-11-04). */}
            {showingMap ? null : <CardsShown />}
            <div className="mx-auto w-full max-w-[1100px]">
              <p className="mb-3 text-[0.78125rem] text-grey">
                {visible.length} of {totalInSegment} member{totalInSegment === 1 ? '' : 's'}
              </p>
              {/* One column on a phone, more as the shell widens. The gap
                  replaces the card's own bottom margin so rows and columns are
                  spaced the same. */}
              {/* The columns follow the shell, not the viewport. At `sm` the deck went
                  two-up while the shell was still capped at 480px, so two cards shared
                  a phone-width column and every name wrapped. */}
              {/* Above `md` the columns fill by width rather than by breakpoint:
                  as many 300px cards as fit. Fixed counts left a ~1000px window
                  with two cards nearly 500px wide each, which is a poster, not
                  a deck. */}
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                {visible.map((member, index) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    priority={index < 2}
                    onOpen={() => {
                      void navigate(`/peers/${member.id}`);
                    }}
                  />
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              /* The advice names the lever that is actually holding the deck
                 shut. "Try widening the filters" was the only line here, and it
                 sends somebody into the sheet to loosen filters they may not
                 have set — the deck is far more often empty because of three
                 words in the search box. */
              <p className="px-6 py-10 text-center text-[0.875rem] text-grey leading-relaxed">
                Nobody matches that yet.
                <br />
                {filters.search
                  ? 'Try fewer words, or clear the search.'
                  : 'Try widening the filters.'}
              </p>
            ) : null}
          </>
        )}
      </div>

      {sheetOpen ? (
        <FilterSheet
          regions={regionsIn(members)}
          conditions={hasConditions(members)}
          organizations={organizations}
          home={{ city: home?.city ?? null, status: distanceStatus }}
          distance={!showingMap}
          ages={ageBandsIn(members)}
          // Frequency-ordered. The sheet draws the common ones and keeps the
          // long tail of one-person topics behind "Show all", where it cannot
          // bury the ones that narrow a deck and is still reachable.
          topics={topicsIn(members)}
          filters={filters}
          matchCount={showingMap ? onMap.length : visible.length}
          activeCount={filterCount}
          onChange={setFilters}
          onClear={() => {
            setFilters(EMPTY_MEMBER_FILTERS);
          }}
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
