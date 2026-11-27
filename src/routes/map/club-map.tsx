import {
  ChevronDown,
  House,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useRsvpSheet } from '@/components/rsvp-sheet';
import { canLocate, deviceLocation } from '@/lib/device-location';
import { setRsvp, useEvents, useViewerEvents } from '@/lib/events';
import { californiaToday, useGrantsByOrganization } from '@/lib/grants';
import {
  type GeoJSONSource,
  loadMapCanvas,
  type MapLibreMap,
  type MapMarker,
  type MapMouseEvent,
} from '@/lib/map';
import { LOWER_48 } from '@/lib/map/tiles';
import type { MapContents, MapOrganization } from '@/lib/map-data';
import { useBrowseMembers } from '@/lib/members';
import { ALL_TYPES, NO_CATEGORY, ORGANIZATION_CATEGORIES } from '@/lib/organization-categories';
import { useOrganizationFollows } from '@/lib/organization-follows';
import { useOrganizations } from '@/lib/organizations';
import { usePhotoUrls } from '@/lib/photos';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { EventCard } from '@/routes/events/event-card';
import { dateWindowRange, filterEvents, isPastEvent } from '@/routes/events/filters';
import { hasOpenGrant, OrganizationRow } from '@/routes/events/organization-list';
import { PlaceContact } from '@/routes/events/place-contact';
import {
  addLayers,
  applyFocus,
  applyTextScale,
  boxOf,
  CITY_CLOSE_ZOOM,
  type CloseUp,
  closeUpOf,
  fitSpread,
  LAYER_IDS,
  PEER_CITY_ZOOM,
  type Picked,
  pageTextScale,
  pick,
  SOURCES,
  STATE_HEIGHT,
  STATE_REACH,
  STATE_SOURCES,
  STATE_WIDTH,
  STATES_APART_FROM,
  STREET_ZOOM,
  setHome,
} from '@/routes/map/map-layers';
import { MapSheet } from '@/routes/map/map-sheet';
import { MapPlaceholder } from '@/routes/map/map-view';
import { MemberRow } from '@/routes/map/member-row';
import { type PhotoSource, setPhotoBoxes } from '@/routes/map/peer-photos';
import {
  apart,
  type Box,
  contentsOf,
  countWords,
  eventFeatures,
  eventSpots,
  type Features,
  foldByState,
  inBox,
  LAYERS,
  type Layer,
  lonePeers,
  notOnMap,
  organizationFeatures,
  organizationSpots,
  otherPlaces,
  type PlaceContents,
  peerCities,
  peerFeatures,
  spotKeyOf,
} from '@/routes/map/places';
import { othersOnly } from '@/routes/peers/filters';
import {
  type BrowseMember,
  type ClubEvent,
  EMPTY_EVENT_FILTERS,
  type Organization,
  type RsvpStatus,
} from '@/types/domain';

/**
 * The club's map, one for Events and Peers (the owner, 2026-10-25): events,
 * members counted by city, and organizations' places, each a layer. Pins are
 * drawn by MapLibre (map-layers.ts); only "your city" and "you are here" are
 * DOM. What the list's filters keep is what is drawn.
 */

export interface ClubMapProps {
  contents: MapContents;
  /** The layer the screen is about: on when the map opens, and when it changes. */
  focus: Layer;
  /** The list's events, filtered. Absent, the map reads the next 30 days. */
  events?: ClubEvent[];
  /** The list's members, filtered. Absent, the map reads the club's. */
  members?: BrowseMember[];
  /** The directory's organizations, filtered. Absent, every one. */
  organizations?: Organization[];
  /** The types hidden, when the screen's filters hold them too; absent, the map's own. */
  types?: { hidden: ReadonlySet<string>; onChange: (hidden: ReadonlySet<string>) => void };
  /** An event as the screen draws it; absent, a card with its own RSVP. */
  renderEvent?: (event: ClubEvent) => ReactNode;
  /** Said where the events layer would be empty for a reason, such as past events. */
  eventsNote?: string | undefined;
  /** Its own chip, for a screen with no filter button in its header. */
  filters?: { label: string; count: number; onOpen: () => void };
  /** A distance just chosen: the map shows that far around the member's city. */
  zoomToMiles?: number | null;
  /** Router state for the detail pages, so back returns to the map. */
  backState: Record<string, string>;
  /** The List view is showing: the map's sources are left alone. */
  hidden?: boolean;
  onUnsupported: () => void;
  /** "View on the map": the event to open on; null `event` is one not found. */
  show?: { id: string; event: ClubEvent | null; ready: boolean } | undefined;
  /** Called once it has been shown, or said to be off the map. */
  onShown?: (() => void) | undefined;
}

/** Half a 44px target around a tap. */
const REACH = 22;
/** A second tap this soon is a double; a single tap's sheet waits this long (touch only). */
const DOUBLE_TAP_MS = 250;
/** A mouse's double-click window; its sheet does not wait. */
const DOUBLE_CLICK_MS = 400;
/** A click this soon after a touch came from a finger. */
const TOUCH_CLICK_MS = 800;
const CITY_ZOOM = 10;
/** The map's own limit (map-canvas.tsx), where a phone stops. */
const FARTHEST_ZOOM = 2;
/** Round the lower 48 at the farthest, so a pin at the edge is not cut off. */
const FARTHEST_PADDING = 40;
const boundsMiddle = ([west, south, east, north]: typeof LOWER_48): [number, number] => [
  (west + east) / 2,
  (south + north) / 2,
];
const NONE_EVENTS: ClubEvent[] = [];
const NONE_MEMBERS: BrowseMember[] = [];

const LAYER_LABELS: Record<Layer, string> = {
  events: 'Events',
  peers: 'Peers',
  organizations: 'Organizations',
};

type Sheet =
  | {
      kind: 'place';
      keys: Record<Layer, Set<string>>;
      zoomTo: Picked['zoomTo'];
      /** An event to list first: the one "View on the map" opened. */
      selected?: string;
    }
  | { kind: 'area'; keys: Record<Layer, Set<string>> }
  | { kind: 'unplaced' };

/** The page's text size, followed as it changes (Me → Display). */
function useTextScale(): number {
  const [scale, setScale] = useState(pageTextScale);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setScale(pageTextScale());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-text-size'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return scale;
}

/** Sets a source's data only when it changed, and never while the map is hidden. */
function useSourceData(
  map: MapLibreMap | null,
  source: string,
  data: Features,
  hidden: boolean,
): void {
  const sent = useRef<{ map: MapLibreMap; data: Features } | null>(null);
  useEffect(() => {
    if (!map || hidden) return;
    if (sent.current?.map === map && sent.current.data === data) return;
    sent.current = { map, data };
    void map.getSource<GeoJSONSource>(source)?.setData(data);
  }, [map, source, data, hidden]);
}

export default function ClubMap({
  contents,
  focus,
  types,
  events,
  members,
  organizations: chosenOrganizations,
  renderEvent,
  eventsNote,
  filters,
  zoomToMiles = null,
  backState,
  hidden = false,
  onUnsupported,
  show,
  onShown,
}: ClubMapProps) {
  // Per mount, so "Try the map again" (map-view.tsx) asks for the script again.
  const [MapCanvas] = useState(() => lazy(loadMapCanvas));
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(() => new Set([focus]));
  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    // Switches, as the toggle says; showing both is Layers' to ask for (the
    // owner, 2026-11-01).
    setLayers(new Set([focus]));
  }
  const [ownHiddenTypes, setOwnHiddenTypes] = useState<ReadonlySet<string>>(() => new Set());
  const hiddenTypes = types?.hidden ?? ownHiddenTypes;
  const setHiddenTypes = types?.onChange ?? setOwnHiddenTypes;
  const [held, setHeld] = useState<MapLibreMap | null>(null);
  // A map MapCanvas removed (a kept tab hidden) is dead at once, before state catches up.
  const live = useRef<MapLibreMap | null>(null);
  const gone = useRef(new WeakSet<MapLibreMap>());
  const map = held && !gone.current.has(held) ? held : null;
  const [box, setBox] = useState<Box | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Read by the map's own handlers, which are bound once.
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const [drawn, setDrawn] = useState(false);
  const [here, setHere] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Over the whole page, tab bar included (the owner, 2026-11-16).
  const [full, setFull] = useState(false);
  const [lastHidden, setLastHidden] = useState(hidden);
  if (hidden !== lastHidden) {
    setLastHidden(hidden);
    if (hidden) setFull(false);
  }
  // Escape leaves it, once nothing on top of the map is open to close first.
  useEffect(() => {
    if (!full || sheet || panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [full, sheet, panelOpen]);
  const scale = useTextScale();
  const frame = useRef<HTMLDivElement>(null);

  // A layer the screen does not supply is read only once it is turned on.
  const [ownEvents, setOwnEvents] = useState<ClubEvent[] | null>(null);
  const [ownMembers, setOwnMembers] = useState<BrowseMember[] | null>(null);
  const directory = useOrganizations().organizations;
  const organizations = chosenOrganizations ?? directory;
  const listedEvents = events ?? ownEvents ?? NONE_EVENTS;
  // An event opened by "View on the map" is drawn even when the filters leave it out.
  const [pinned, setPinned] = useState<ClubEvent | null>(null);
  const shownEvents = useMemo(
    () =>
      pinned && !listedEvents.some((event) => event.id === pinned.id)
        ? [...listedEvents, pinned]
        : listedEvents,
    [listedEvents, pinned],
  );
  const shownMembers = members ?? ownMembers ?? NONE_MEMBERS;

  const spots = useMemo(
    () => eventSpots(contents.events, shownEvents),
    [contents.events, shownEvents],
  );
  const cities = useMemo(
    () => peerCities(contents.peerCities, shownMembers),
    [contents.peerCities, shownMembers],
  );
  const placedOrganizations = useMemo(() => {
    const placed = organizationSpots(contents.organizations, organizations);
    if (hiddenTypes.size === 0) return placed;
    // A place shared with a type still shown stays, for the ones still shown.
    const spots = placed.spots.flatMap((spot) => {
      const kept = spot.organizations.filter(
        (organization) => !hiddenTypes.has(organization.category ?? NO_CATEGORY),
      );
      return kept.length > 0 ? [{ ...spot, organizations: kept }] : [];
    });
    return { ...placed, spots };
  }, [contents.organizations, organizations, hiddenTypes]);
  const missingPeers = useMemo(
    () => notOnMap(contents.peerCities, shownMembers),
    [contents.peerCities, shownMembers],
  );

  // Read by the map's own handlers, which are bound once.
  const current = useRef({ layers });
  current.current = { layers };

  const onReady = useCallback((created: MapLibreMap | null) => {
    if (!created) {
      if (live.current) gone.current.add(live.current);
      live.current = null;
      setHeld(null);
      return;
    }
    addLayers(created);
    // Doubles are ours: up close on a pin, MapLibre's step elsewhere.
    created.doubleClickZoom.disable();
    setBox(boxOf(created));
    live.current = created;
    setHeld(created);
  }, []);

  // What the filters keep, as the map's data; counts follow.
  const eventData = useMemo(() => eventFeatures(spots), [spots]);
  const peerData = useMemo(() => peerFeatures(cities), [cities]);
  const organizationData = useMemo(
    () => organizationFeatures(placedOrganizations.spots),
    [placedOrganizations],
  );
  // Spaced for the zoom in half steps, redrawn when a zoom ends, never during one.
  const [farZoom, setFarZoom] = useState(STATES_APART_FROM);
  const width = STATE_WIDTH * scale;
  const height = STATE_HEIGHT * scale;
  const reach = STATE_REACH * scale;
  const eventStates = useMemo(
    () => apart(foldByState(eventData), farZoom, width, height, reach),
    [eventData, farZoom, width, height, reach],
  );
  const peerStates = useMemo(
    () => apart(foldByState(peerData), farZoom, width, height, reach),
    [peerData, farZoom, width, height, reach],
  );
  const organizationStates = useMemo(
    () => apart(foldByState(organizationData), farZoom, width, height, reach),
    [organizationData, farZoom, width, height, reach],
  );
  // A place's one member shows their photograph (the owner, 2026-10-28).
  const lone = useMemo(() => lonePeers(cities), [cities]);
  const lonePhotos = usePhotoUrls(
    layers.has('peers') ? lone.map((member) => member.photoPath) : [],
    'thumb',
  );
  const photoSources = useMemo(
    () =>
      new Map<string, PhotoSource>(
        lone.flatMap((member) =>
          member.photoPath
            ? [
                [
                  member.id,
                  { photoPath: member.photoPath, url: lonePhotos.get(member.photoPath) ?? null },
                ],
              ]
            : [],
        ),
      ),
    [lone, lonePhotos],
  );
  useEffect(() => {
    if (map) setPhotoBoxes(map, photoSources);
  }, [map, photoSources]);
  useSourceData(map, SOURCES.events, eventData, hidden);
  useSourceData(map, SOURCES.peers, peerData, hidden);
  useSourceData(map, SOURCES.organizations, organizationData, hidden);
  useSourceData(map, STATE_SOURCES.events, eventStates, hidden);
  useSourceData(map, STATE_SOURCES.peers, peerStates, hidden);
  useSourceData(map, STATE_SOURCES.organizations, organizationStates, hidden);

  useEffect(() => {
    if (map) applyTextScale(map, scale);
  }, [map, scale]);

  const home = contents.home;
  useEffect(() => {
    if (map) setHome(map, home ? [home.longitude, home.latitude] : null);
  }, [map, home]);

  useEffect(() => {
    if (!map) return;
    for (const layer of LAYERS) {
      for (const id of LAYER_IDS[layer]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', layers.has(layer) ? 'visible' : 'none');
        }
      }
    }
  }, [map, layers]);

  // For a measurement and a test: the first settled frame with a pin in it.
  useEffect(() => {
    if (!map || drawn) return;
    const ids = LAYERS.filter((layer) => layers.has(layer)).flatMap((layer) => LAYER_IDS[layer]);
    const check = () => {
      if (map.queryRenderedFeatures({ layers: ids }).length > 0) setDrawn(true);
    };
    map.on('idle', check);
    return () => {
      map.off('idle', check);
    };
  }, [map, drawn, layers]);

  // On a wide screen the states have room, so the map stops where they fill it.
  useEffect(() => {
    if (!map) return;
    const stopAt = () => {
      const fit = map.cameraForBounds(LOWER_48, { padding: FARTHEST_PADDING })?.zoom;
      if (fit === undefined) return;
      const halfStep = Math.floor(fit * 2) / 2;
      map.setMinZoom(Math.min(Math.max(halfStep, FARTHEST_ZOOM), STATES_APART_FROM - 0.5));
    };
    // At the farthest, the whole country, not whichever part the zoom began on.
    const showThemAll = () => {
      if (map.getZoom() > map.getMinZoom()) return;
      map.easeTo({ center: boundsMiddle(LOWER_48) });
    };
    stopAt();
    map.on('resize', stopAt);
    map.on('zoomend', showThemAll);
    return () => {
      map.off('resize', stopAt);
      map.off('zoomend', showThemAll);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const onMoved = () => {
      setBox(boxOf(map));
      setFarZoom(Math.min(Math.floor(map.getZoom() * 2) / 2, STATES_APART_FROM));
    };
    onMoved();
    const onMoving = () => {
      setNotice(null);
    };
    const visibleIds = () =>
      LAYERS.filter((layer) => current.current.layers.has(layer))
        .flatMap((layer) => LAYER_IDS[layer])
        .filter((id) => map.getLayer(id));
    const near = (point: { x: number; y: number }) => {
      const { x, y } = point;
      return map.queryRenderedFeatures(
        [
          [x - REACH, y - REACH],
          [x + REACH, y + REACH],
        ],
        { layers: visibleIds() },
      );
    };
    // A double on a pin goes up close; elsewhere, MapLibre's step in, done
    // here as its own double-click zoom is off (onReady). A mouse's first
    // click opens the sheet at once, beside the map; a finger's waits out
    // the double-tap window, as the phone's sheet would take the second tap.
    let last: { at: number; x: number; y: number } | null = null;
    let lastTouch = Number.NEGATIVE_INFINITY;
    let opening: ReturnType<typeof setTimeout> | undefined;
    const onTouch = () => {
      lastTouch = performance.now();
    };
    // Touching the map with Layers open closes Layers, as outside any panel.
    const closePanel = () => {
      if (panelOpenRef.current) setPanelOpen(false);
    };
    const onClick = (event: MapMouseEvent) => {
      if (panelOpenRef.current) {
        closePanel();
        last = null;
        return;
      }
      const at = performance.now();
      const touch = at - lastTouch < TOUCH_CLICK_MS;
      const { x, y } = event.point;
      const double =
        last !== null &&
        at - last.at < (touch ? DOUBLE_TAP_MS : DOUBLE_CLICK_MS) &&
        Math.hypot(x - last.x, y - last.y) < REACH;
      if (double) {
        last = null;
        clearTimeout(opening);
        const hit = near(event.point)[0];
        if (!hit) {
          const shift = (event.originalEvent as MouseEvent | undefined)?.shiftKey === true;
          map.easeTo({ zoom: map.getZoom() + (shift ? -1 : 1), around: event.lngLat });
          return;
        }
        // A bubble of places apart: around all of them, as a single tap.
        pick(map, [hit], [event.lngLat.lng, event.lngLat.lat])
          .then(async ({ spread, atLeast }) => {
            if (live.current !== map) return;
            if (spread) {
              fitSpread(map, spread, atLeast);
              return;
            }
            const target = await closeUpOf(map, hit);
            if (target && live.current === map) map.easeTo(target);
          })
          .catch(() => undefined);
        return;
      }
      last = { at, x, y };
      const hits = near(event.point);
      if (hits.length === 0) return;
      const open = () => {
        // The map can be removed before a cluster answers; then the tap is moot.
        pick(map, hits, [event.lngLat.lng, event.lngLat.lat])
          .then(({ keys, zoomTo, spread, atLeast }) => {
            if (live.current !== map) return;
            // A bubble of places apart zooms in around them so they come
            // apart (the owner, 2026-10-28); one place, or a bubble that is
            // all one place, opens the sheet.
            if (spread) fitSpread(map, spread, atLeast);
            else setSheet({ kind: 'place', keys, zoomTo });
          })
          .catch(() => undefined);
      };
      if (touch) opening = setTimeout(open, DOUBLE_TAP_MS);
      else open();
    };
    // At most once a frame, however fast the pointer moves.
    let pending: { x: number; y: number } | null = null;
    let raf = 0;
    const onPointer = (event: MapMouseEvent) => {
      pending = event.point;
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        if (pending) map.getCanvas().style.cursor = near(pending).length > 0 ? 'pointer' : '';
      });
    };
    map.on('moveend', onMoved);
    map.on('movestart', onMoving);
    map.on('click', onClick);
    map.on('dragstart', closePanel);
    map.on('touchstart', onTouch);
    map.on('mousemove', onPointer);
    return () => {
      clearTimeout(opening);
      cancelAnimationFrame(raf);
      map.off('touchstart', onTouch);
      map.off('moveend', onMoved);
      map.off('movestart', onMoving);
      map.off('click', onClick);
      map.off('dragstart', closePanel);
      map.off('mousemove', onPointer);
    };
  }, [map]);

  const inView = useMemo(() => {
    const keep = <T extends { latitude: number; longitude: number }>(
      layer: Layer,
      places: T[],
    ): T[] => (box && layers.has(layer) ? places.filter((place) => inBox(place, box)) : []);
    return {
      spots: keep('events', spots),
      cities: keep('peers', cities),
      organizations: keep('organizations', placedOrganizations.spots),
    };
  }, [box, layers, spots, cities, placedOrganizations]);
  const inViewContents = contentsOf(inView.spots, inView.cities, inView.organizations);
  const inViewLayers = withSomething(inViewContents, layers);

  const sheetSpots =
    sheet && sheet.kind !== 'unplaced'
      ? placedOrganizations.spots.filter((spot) => sheet.keys.organizations.has(spot.key))
      : [];
  const sheetContents = (keys: Record<Layer, Set<string>>): PlaceContents =>
    contentsOf(
      spots.filter((spot) => keys.events.has(spot.key)),
      cities.filter((city) => keys.peers.has(city.key)),
      placedOrganizations.spots.filter((spot) => keys.organizations.has(spot.key)),
    );

  // An organization's sheet: its other places ringed, the rest faded. A group
  // of several is faded to them, not ringed: rings for all would fill the map.
  const focusIds = sheet?.kind === 'place' ? sheetSpots.flatMap((s) => s.organizations) : [];
  const focusKey = focusIds.map((o) => o.id).join(',');
  const herePlaces = new Set(sheetSpots.flatMap((spot) => spot.places.map((p) => p.placeId)));
  const hereKey = [...herePlaces].join(',');
  const rings = useMemo(
    () =>
      focusKey !== '' && !focusKey.includes(',')
        ? otherPlaces(
            contents.organizations,
            new Set(focusKey.split(',')),
            new Set(hereKey ? hereKey.split(',') : []),
          )
        : [],
    [contents.organizations, focusKey, hereKey],
  );
  useEffect(() => {
    if (!map || hidden) return;
    applyFocus(map, focusKey ? { organizationIds: focusKey.split(','), rings } : null);
  }, [map, hidden, focusKey, rings]);

  /** Moves the map to a place, clear of the open sheet. */

  /** Moves the map to a place, clear of the open sheet. */
  const goTo = (place: MapOrganization) => {
    if (!map) return;
    map.easeTo({
      center: [place.longitude, place.latitude],
      zoom: Math.max(map.getZoom(), 11),
      offset: clearOfSheet(frame.current),
    });
  };

  // "View on the map": once the map and the event are ready, its sheet opens
  // and the map goes to it, at a street (exact) or the city (approximate).
  const showing = useRef<string | null>(null);
  const [centreOn, setCentreOn] = useState<{ at: [number, number]; zoom: number } | null>(null);
  const done = useRef(onShown);
  done.current = onShown;
  useEffect(() => {
    if (!show) showing.current = null;
    if (!map || hidden || !show?.ready || showing.current === show.id) return;
    showing.current = show.id;
    const place = contents.events.find((event) => event.id === show.id);
    if (!place || !show.event) {
      setNotice('This event isn’t on the map yet.');
    } else {
      setPinned(show.event);
      setLayers((now) => (now.has('events') ? now : new Set([...now, 'events'])));
      setSheet({
        kind: 'place',
        keys: { events: new Set([spotKeyOf(place)]), peers: new Set(), organizations: new Set() },
        zoomTo: null,
        selected: show.id,
      });
      setCentreOn({ at: [place.longitude, place.latitude], zoom: place.exact ? 15 : 11 });
    }
    done.current?.();
  }, [map, hidden, show, contents.events]);
  // After the sheet is drawn, so the event lands in the map it leaves showing.
  useEffect(() => {
    if (!map || !centreOn) return;
    // Reduced motion: MapLibre makes this a jump (MapCanvas's reduceMotion).
    map.easeTo({ center: centreOn.at, zoom: centreOn.zoom, offset: clearOfSheet(frame.current) });
    setCentreOn(null);
  }, [map, centreOn]);

  const locate = () => {
    setNotice(null);
    if (!canLocate()) {
      setNotice('This browser can’t share a location. You can still move the map by hand.');
      return;
    }
    setLocating(true);
    // Kept on this device, in this screen only: never sent, never stored.
    // A browser is asked for approximate only; the iPhone app asks its own way.
    void deviceLocation({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }).then(
      (result) => {
        setLocating(false);
        if (!result.ok) {
          setNotice(
            result.failure === 'denied'
              ? 'Location is off for the club. You can turn it on in your settings, or move the map by hand.'
              : 'Couldn’t find where you are just now. You can move the map by hand.',
          );
          return;
        }
        const at: [number, number] = [result.position.longitude, result.position.latitude];
        setHere(at);
        const now = live.current;
        now?.easeTo({ center: at, zoom: Math.max(now.getZoom(), 12) });
        setNotice('Showing where you are. It stays on this device.');
      },
    );
  };

  const markers: MapMarker[] = here ? [{ id: 'here', at: here, children: <YouAreHere /> }] : [];

  const toggleLayer = (layer: Layer) => {
    setLayers((now) => {
      const next = new Set(now);
      if (!next.delete(layer)) next.add(layer);
      return next;
    });
  };
  // On a change of distance, not on every return to the map: where somebody
  // has moved it to is theirs until they ask for another.
  const zoomedTo = useRef<number | null>(null);
  const homePoint = contents.home;
  useEffect(() => {
    if (!map || hidden || !homePoint || zoomToMiles === zoomedTo.current) return;
    zoomedTo.current = zoomToMiles;
    if (zoomToMiles === null) return;
    const north = zoomToMiles / 69;
    const east = north / Math.cos((homePoint.latitude * Math.PI) / 180);
    map.fitBounds(
      [
        [homePoint.longitude - east, homePoint.latitude - north],
        [homePoint.longitude + east, homePoint.latitude + north],
      ],
      { padding: 24 },
    );
  }, [map, hidden, homePoint, zoomToMiles]);

  const toggleType = (type: string) => {
    const next = new Set(hiddenTypes);
    if (!next.delete(type)) next.add(type);
    setHiddenTypes(next);
  };

  // One place in a tapped sheet: what a double on its pin does, for a keyboard too.
  const closeUp = ((): CloseUp | null => {
    if (sheet?.kind !== 'place') return null;
    const e = spots.filter((spot) => sheet.keys.events.has(spot.key));
    const p = cities.filter((city) => sheet.keys.peers.has(city.key));
    const o = placedOrganizations.spots.filter((spot) => sheet.keys.organizations.has(spot.key));
    const [only] = [...e, ...p, ...o];
    if (!only || e.length + p.length + o.length !== 1) return null;
    const center: [number, number] = [only.longitude, only.latitude];
    if (p.length) return { center, zoom: Math.max(map?.getZoom() ?? 0, PEER_CITY_ZOOM) };
    const exact = 'exact' in only && only.exact;
    return { center, zoom: exact ? STREET_ZOOM : CITY_CLOSE_ZOOM };
  })();

  const eventsQuiet = eventsNote && layers.has('events') ? eventsNote : null;

  return (
    <div
      ref={frame}
      className={full ? 'fixed inset-0 z-50 bg-canvas' : 'absolute inset-0'}
      data-pins={drawn ? 'shown' : 'none'}
    >
      {layers.has('events') && !events ? <OwnEvents onRead={setOwnEvents} /> : null}
      {layers.has('peers') && !members ? <OwnMembers onRead={setOwnMembers} /> : null}

      {/* Its own boundary, so this screen keeps its state while MapLibre arrives. */}
      <Suspense fallback={<MapPlaceholder />}>
        <MapCanvas
          {...(contents.home
            ? { center: [contents.home.longitude, contents.home.latitude], zoom: CITY_ZOOM }
            : {})}
          label="Map of the club’s events, members and organizations"
          onReady={onReady}
          onUnsupported={onUnsupported}
          markers={markers}
          controls={
            <>
              <button
                type="button"
                aria-label={full ? 'Exit full screen' : 'Full screen map'}
                aria-pressed={full}
                onClick={() => {
                  setFull(!full);
                }}
                className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-paper text-ink shadow-sm hover:bg-tint"
              >
                {full ? (
                  <Minimize2 aria-hidden="true" className="h-5 w-5" />
                ) : (
                  <Maximize2 aria-hidden="true" className="h-5 w-5" />
                )}
              </button>
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                aria-label="Use my location"
                aria-busy={locating}
                className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-paper text-ink shadow-sm hover:bg-tint disabled:opacity-60"
              >
                <LocateFixed aria-hidden="true" className="h-5 w-5" />
              </button>
            </>
          }
        />
      </Suspense>

      <div
        className={cn(
          'pointer-events-none absolute inset-x-3 flex flex-wrap items-start gap-2',
          // Clear of the notch with the page's own header gone.
          full ? 'top-[max(0.75rem,env(safe-area-inset-top))]' : 'top-3',
        )}
      >
        {filters ? (
          <button
            type="button"
            onClick={filters.onOpen}
            aria-label={filters.count ? `${filters.label}, ${filters.count} active` : filters.label}
            className={CHIP}
          >
            <SlidersHorizontal aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={2} />
            {filters.label}
            {filters.count ? (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-action px-1.5 text-[0.75rem] text-white">
                {filters.count}
              </span>
            ) : null}
          </button>
        ) : null}
        <LayerPanel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          layers={layers}
          onToggle={toggleLayer}
          hiddenTypes={hiddenTypes}
          onToggleType={toggleType}
          onHideTypes={setHiddenTypes}
          unplaced={placedOrganizations.unplaced.length}
          missingPeers={layers.has('peers') ? missingPeers : 0}
          onShowUnplaced={() => {
            setPanelOpen(false);
            setSheet({ kind: 'unplaced' });
          }}
        />
      </div>

      <div className="pointer-events-none absolute right-[72px] bottom-[max(1.75rem,calc(env(safe-area-inset-bottom)+1.5rem))] left-3 flex flex-col items-start gap-2">
        <p
          role="status"
          className={cn(
            'max-w-[24rem] rounded-xl bg-paper px-3 py-2 text-[0.8125rem] text-ink leading-[1.4] shadow-sm',
            notice ? '' : 'sr-only',
          )}
        >
          {notice}
        </p>
        {eventsQuiet ? (
          <p className="max-w-[24rem] rounded-xl bg-paper px-3 py-2 text-[0.8125rem] text-ink leading-[1.4] shadow-sm">
            {eventsQuiet}
          </p>
        ) : null}
        {layers.size === 0 ? (
          <p className="rounded-xl bg-paper px-3 py-2 text-[0.8125rem] text-ink shadow-sm">
            Every layer is off. Turn one on in Layers.
          </p>
        ) : inViewLayers.size > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSheet({
                kind: 'area',
                keys: {
                  events: new Set(inView.spots.map((spot) => spot.key)),
                  peers: new Set(inView.cities.map((city) => city.key)),
                  organizations: new Set(inView.organizations.map((spot) => spot.key)),
                },
              });
            }}
            className={CHIP}
          >
            {countWords(inViewContents, inViewLayers)} in this area
          </button>
        ) : eventsQuiet ? null : (
          <p className="rounded-xl bg-paper px-3 py-2 text-[0.8125rem] text-ink shadow-sm">
            Nothing in this area. Zoom out, or change the filters.
          </p>
        )}
      </div>

      {sheet?.kind === 'unplaced' ? (
        <MapSheet
          title="Not on the map"
          subtitle="Organizations with no place the map can draw, such as those that work nationwide."
          onClose={() => {
            setSheet(null);
          }}
        >
          <OrganizationRows
            organizations={placedOrganizations.unplaced}
            places={contents.organizations}
            events={shownEvents}
            backState={backState}
          />
        </MapSheet>
      ) : sheet ? (
        <PlaceSheet
          // Another place opens fresh, though the last was minimized and the title is the same.
          key={LAYERS.flatMap((layer) => [...sheet.keys[layer]]).join()}
          contents={sheetContents(sheet.keys)}
          layers={layers}
          area={sheet.kind === 'area'}
          zoomIn={
            sheet.kind === 'place' && map && (sheet.zoomTo ?? closeUp)
              ? () => {
                  const target = sheet.zoomTo ?? closeUp;
                  if (target) map.easeTo(target);
                  setSheet(null);
                }
              : undefined
          }
          zoomLabel={sheet.kind === 'place' && sheet.zoomTo ? 'Zoom in here' : 'Show up close'}
          events={shownEvents}
          {...(sheet.kind === 'place' && sheet.selected ? { selected: sheet.selected } : {})}
          places={contents.organizations}
          here={herePlaces}
          onGoTo={goTo}
          renderEvent={renderEvent}
          backState={backState}
          onClose={() => {
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The layers that are on and have something in `contents`. */
function withSomething(contents: PlaceContents, layers: ReadonlySet<Layer>): ReadonlySet<Layer> {
  const sizes: Record<Layer, number> = {
    events: contents.events.length,
    peers: contents.members.length,
    organizations: contents.organizations.length,
  };
  return new Set(LAYERS.filter((layer) => layers.has(layer) && sizes[layer] > 0));
}

/** How far to shift a target so it sits in the map left uncovered by the open sheet. */
function clearOfSheet(frame: HTMLElement | null): [number, number] {
  const panel = frame?.querySelector('[role="dialog"]')?.getBoundingClientRect();
  const whole = frame?.getBoundingClientRect();
  if (!panel || !whole) return [0, 0];
  // A phone's sheet covers the bottom; a desktop's panel the left.
  if (panel.width >= whole.width - 1) return [0, -Math.min(panel.height, whole.height - 80) / 2];
  return [(panel.right - whole.left) / 2, 0];
}

const CHIP =
  'pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-paper px-4 font-semibold text-[0.875rem] text-ink shadow-sm transition-colors hover:bg-tint';

function OwnEvents({ onRead }: { onRead: (events: ClubEvent[]) => void }) {
  const [range] = useState(() => dateWindowRange('next30') ?? {});
  const { events } = useEvents(range);
  useEffect(() => {
    // A cancelled date is not somewhere to go (20261127100000).
    onRead(
      filterEvents(
        events.filter((event) => !event.cancelled),
        { ...EMPTY_EVENT_FILTERS, withinMiles: null },
        'upcoming',
      ),
    );
  }, [events, onRead]);
  return null;
}

function OwnMembers({ onRead }: { onRead: (members: BrowseMember[]) => void }) {
  const { members } = useBrowseMembers();
  const session = useSession();
  const me = session.status === 'signed-in' ? session.userId : null;
  useEffect(() => {
    onRead(othersOnly(members, me));
  }, [members, me, onRead]);
  return null;
}

function LayerPanel({
  open,
  onOpenChange,
  layers,
  onToggle,
  hiddenTypes,
  onToggleType,
  onHideTypes,
  unplaced,
  missingPeers,
  onShowUnplaced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: ReadonlySet<Layer>;
  onToggle: (layer: Layer) => void;
  hiddenTypes: ReadonlySet<string>;
  onToggleType: (type: string) => void;
  onHideTypes: (hidden: ReadonlySet<string>) => void;
  unplaced: number;
  /** In the list, not on the map: the map is off for them, or their city is not placed. */
  missingPeers: number;
  onShowUnplaced: () => void;
}) {
  const panelId = useId();
  const [typesOpen, setTypesOpen] = useState(false);
  const typesHidden = ORGANIZATION_CATEGORIES.filter((type) => hiddenTypes.has(type.id)).length;
  const allHidden = ALL_TYPES.every((type) => hiddenTypes.has(type));

  // As tall as the map leaves it, then it scrolls: the types run past a short
  // screen (the owner, 2026-11-01).
  const panel = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const top = panel.current?.getBoundingClientRect().top;
      const bottom = panel.current?.closest('[data-pins]')?.getBoundingClientRect().bottom;
      if (top === undefined || bottom === undefined) return;
      setRoom(bottom - top > 0 ? bottom - top - 12 : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    // Not positioned itself: the panel hangs from the whole row, so it fits a phone.
    <div className="pointer-events-auto">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          onOpenChange(!open);
        }}
        className={CHIP}
      >
        <Layers aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={2} />
        Layers
      </button>
      {open ? (
        <div
          id={panelId}
          ref={panel}
          style={room ? { maxHeight: room } : undefined}
          className="pointer-events-auto absolute top-full left-0 z-[15] mt-2 w-[min(20rem,100%)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-paper p-2 shadow-[0_12px_32px_rgba(10,20,35,.25)]"
        >
          <fieldset>
            <legend className="sr-only">Show on the map</legend>
            {LAYERS.map((layer) => (
              <label
                key={layer}
                className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl px-2.5 hover:bg-tint"
              >
                <input
                  type="checkbox"
                  checked={layers.has(layer)}
                  onChange={() => {
                    onToggle(layer);
                  }}
                  className="h-5 w-5 flex-none accent-[var(--action)]"
                />
                <LayerKey layer={layer} />
                <span className="font-semibold text-[0.9375rem] text-ink">
                  {LAYER_LABELS[layer]}
                </span>
              </label>
            ))}
          </fieldset>
          {layers.has('organizations') ? (
            <>
              <button
                type="button"
                aria-expanded={typesOpen}
                onClick={() => {
                  setTypesOpen((now) => !now);
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-2.5 font-semibold text-[0.875rem] text-emphasis hover:bg-tint"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn('h-4 w-4 transition-transform', typesOpen && 'rotate-180')}
                />
                Organization types
                {typesHidden > 0 ? (
                  <span className="font-normal text-ink2">({typesHidden} hidden)</span>
                ) : null}
              </button>
              {typesOpen ? (
                <fieldset className="mb-1">
                  <legend className="sr-only">Types of organization</legend>
                  <div className="flex gap-4 px-2.5 pb-1">
                    <button
                      type="button"
                      disabled={hiddenTypes.size === 0}
                      onClick={() => {
                        onHideTypes(new Set());
                      }}
                      className="min-h-[36px] font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2 disabled:text-grey disabled:no-underline"
                    >
                      Check all
                    </button>
                    <button
                      type="button"
                      disabled={allHidden}
                      onClick={() => {
                        onHideTypes(new Set(ALL_TYPES));
                      }}
                      className="min-h-[36px] font-semibold text-[0.8125rem] text-emphasis underline underline-offset-2 disabled:text-grey disabled:no-underline"
                    >
                      Uncheck all
                    </button>
                  </div>
                  {ORGANIZATION_CATEGORIES.map((type) => (
                    <label
                      key={type.id}
                      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2.5 hover:bg-tint"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenTypes.has(type.id)}
                        onChange={() => {
                          onToggleType(type.id);
                        }}
                        className="h-5 w-5 flex-none accent-[var(--action)]"
                      />
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 26 34"
                        className="h-[30px] w-[23px] flex-none"
                      >
                        <path
                          d="M13 33C9.5 25 1.5 20 1.5 13a11.5 11.5 0 1 1 23 0c0 7-8 12-11.5 20Z"
                          fill={type.color}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                        <path
                          d={type.icon}
                          transform="translate(5.5 5.5) scale(0.625)"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="text-[0.875rem] text-ink">{type.label}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}
          <p className="mt-1 flex items-center gap-2.5 px-2.5 py-1.5 text-[0.8125rem] text-ink2 leading-[1.4]">
            <span
              aria-hidden="true"
              className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 border-[#102a4c] bg-white"
            >
              <House className="h-2.5 w-2.5 fill-[#102a4c] text-[#102a4c]" strokeWidth={2.5} />
            </span>
            The house is your city, as your profile gives it.
          </p>
          <p className="px-2.5 py-1.5 text-[0.8125rem] text-ink2 leading-[1.4]">
            Members are placed at the middle of their ZIP code, or of their city without one, never
            closer.
          </p>
          {missingPeers > 0 ? (
            <p className="px-2.5 py-1.5 text-[0.8125rem] text-ink2 leading-[1.4]">
              {missingPeers === 1
                ? '1 peer in the list isn’t'
                : `${missingPeers} peers in the list aren’t`}{' '}
              on the map: they turned it off, or their city can’t be placed yet.
            </p>
          ) : null}
          {unplaced > 0 ? (
            <button
              type="button"
              onClick={onShowUnplaced}
              className="mt-1 min-h-[44px] w-full rounded-xl px-2.5 text-left font-semibold text-[0.875rem] text-emphasis underline underline-offset-2 hover:bg-tint"
            >
              Not on the map: {unplaced} organization{unplaced === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Each layer's pin, small, beside its name. */
function LayerKey({ layer }: { layer: Layer }) {
  if (layer === 'events') {
    return (
      <svg aria-hidden="true" viewBox="0 0 26 34" className="h-[23px] w-[18px] flex-none">
        <path
          d="M13 33C9.5 25 1.5 20 1.5 13a11.5 11.5 0 1 1 23 0c0 7-8 12-11.5 20Z"
          fill="#102a4c"
          stroke="#d4a83a"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="13" cy="13" r="4.5" fill="#ffffff" />
      </svg>
    );
  }
  if (layer === 'peers') {
    return (
      <span
        aria-hidden="true"
        className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[6px] border-2 border-[#102a4c] bg-[#d4a83a] font-bold text-[#102a4c] text-[0.6875rem]"
      >
        6
      </span>
    );
  }
  // The map shows each organization's own logo in this ring.
  return (
    <span
      aria-hidden="true"
      className="h-[20px] w-[20px] flex-none rounded-full border-[3px] border-[#3b4252] bg-white shadow-[0_0_0_1px_#ffffff]"
    />
  );
}

function YouAreHere() {
  return (
    <span role="img" aria-label="You are here" className="block rounded-full bg-[#2563eb]/20 p-2">
      <span className="block h-4 w-4 rounded-full border-[3px] border-white bg-[#2563eb] shadow-[0_0_0_1px_#1e3a8a]" />
    </span>
  );
}

export function PlaceSheet({
  contents: given,
  layers,
  area,
  zoomIn,
  zoomLabel = 'Zoom in here',
  events,
  places = [],
  here = new Set(),
  onGoTo,
  selected,
  renderEvent,
  backState,
  onClose,
}: {
  contents: PlaceContents;
  layers: ReadonlySet<Layer>;
  area: boolean;
  zoomIn: (() => void) | undefined;
  /** "Zoom in here" for a cluster, "Show up close" for one place. */
  zoomLabel?: string;
  events: ClubEvent[];
  /** Every organization place on the map, for "Also in". */
  places?: MapOrganization[];
  /** The places this sheet is about. */
  here?: ReadonlySet<string>;
  onGoTo?: (place: MapOrganization) => void;
  /** Listed first. */
  selected?: string;
  renderEvent: ((event: ClubEvent) => ReactNode) | undefined;
  backState: Record<string, string>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const first = (item: { event: ClubEvent }) => (item.event.id === selected ? 0 : 1);
  const contents = selected
    ? { ...given, events: [...given.events].sort((a, b) => first(a) - first(b)) }
    : given;
  const shown = withSomething(contents, layers);
  const words = countWords(contents, shown);
  const cityNames = [
    ...new Set([
      ...contents.events.filter((item) => !item.exact).map((item) => item.event.city),
      ...contents.members.map((member) => member.city),
    ]),
  ].filter((city): city is string => Boolean(city));

  return (
    <MapSheet
      title={words ? `${words} ${area ? 'in this area' : 'here'}` : 'Nothing here now'}
      subtitle={
        !area && cityNames.length === 1 && contents.events.every((item) => !item.exact)
          ? cityNames[0]
          : undefined
      }
      action={
        zoomIn ? (
          <button
            type="button"
            onClick={zoomIn}
            className="mt-1 min-h-[44px] font-semibold text-[0.875rem] text-emphasis underline underline-offset-2"
          >
            {zoomLabel}
          </button>
        ) : undefined
      }
      onClose={onClose}
    >
      {words ? null : (
        <p className="py-6 text-center text-[0.875rem] text-ink2">
          The filters have changed what is shown here.
        </p>
      )}
      {shown.has('events') ? (
        <Section title="Events">
          {renderEvent ? (
            contents.events.map(({ event, exact }) => (
              <div key={event.id}>
                {exact ? null : <Approximate city={event.city} />}
                {renderEvent(event)}
              </div>
            ))
          ) : (
            <OwnEventCards items={contents.events} backState={backState} />
          )}
        </Section>
      ) : null}
      {shown.has('peers') ? (
        <Section title="Members">
          <p className="mb-2.5 text-[0.8125rem] text-ink2">
            Counted by city only. Nobody is placed any finer.
          </p>
          <ul className="-mx-2">
            {contents.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                withCity={area || cityNames.length > 1}
                onOpen={() => {
                  void navigate(`/peers/${member.id}`, { state: backState });
                }}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {shown.has('organizations') ? (
        <Section title="Organizations">
          <OrganizationRows
            organizations={contents.organizations}
            places={places}
            here={area ? undefined : here}
            onGoTo={onGoTo}
            events={events}
            backState={backState}
          />
        </Section>
      ) : null}
    </MapSheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Approximate({ city }: { city: string | null }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] text-ink2">
      <MapPin aria-hidden="true" className="h-4 w-4 flex-none" />
      <span>
        <span className="font-bold text-ink">Approximate location</span>
        {city ? ` · at the middle of ${city}` : null}
      </span>
    </p>
  );
}

/** Where the screen draws no event cards of its own (Peers): each with its own RSVP. */
function OwnEventCards({
  items,
  backState,
}: {
  items: PlaceContents['events'];
  backState: Record<string, string>;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const memberId = session.status === 'signed-in' ? session.userId : null;
  const viewer = useViewerEvents(memberId);
  const { byId } = useOrganizations();
  const { saved, sheet } = useRsvpSheet(memberId);
  function onRsvp(event: ClubEvent, next: RsvpStatus | null) {
    if (!memberId) return;
    void setRsvp(event.id, memberId, next).then((result) => {
      if (result.ok) {
        viewer.reload();
        saved(event, next, (again) => {
          onRsvp(event, again);
        });
      }
    });
  }
  return (
    <>
      {items.map(({ event, exact }) => (
        <div key={event.id}>
          {exact ? null : <Approximate city={event.city} />}
          <EventCard
            event={event}
            past={isPastEvent(event)}
            status={viewer.rsvps.get(event.id) ?? null}
            organization={event.organizationId ? (byId.get(event.organizationId) ?? null) : null}
            onOpen={() => {
              void navigate(`/events/${event.id}`, { state: backState });
            }}
            onOpenOrganization={(id) => {
              void navigate(`/events/organizations/${id}`, { state: backState });
            }}
            onOpenMember={(id) => {
              void navigate(`/peers/${id}`, { state: backState });
            }}
            onRsvp={(next) => {
              onRsvp(event, next);
            }}
          />
        </div>
      ))}
      {sheet}
    </>
  );
}

function OrganizationRows({
  organizations,
  places,
  here,
  onGoTo,
  events,
  backState,
}: {
  organizations: Organization[];
  places: MapOrganization[];
  /** Given, each row offers the organization's other places. */
  here?: ReadonlySet<string> | undefined;
  onGoTo?: ((place: MapOrganization) => void) | undefined;
  events: ClubEvent[];
  backState: Record<string, string>;
}) {
  const navigate = useNavigate();
  const follows = useOrganizationFollows();
  const grants = useGrantsByOrganization();
  const today = californiaToday();
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.organizationId) {
      counts.set(event.organizationId, (counts.get(event.organizationId) ?? 0) + 1);
    }
  }
  return organizations.map((organization) => {
    const theirs = places.filter((place) => place.id === organization.id);
    const others = here ? theirs.filter((place) => !here.has(place.placeId)) : [];
    return (
      <div key={organization.id}>
        <OrganizationRow
          organization={organization}
          eventCount={counts.get(organization.id) ?? 0}
          grants={grants.get(organization.id)?.length ?? 0}
          grantOpen={hasOpenGrant(grants.get(organization.id), today)}
          following={follows.following.has(organization.id)}
          requested={follows.requested.has(organization.id)}
          onToggleFollow={follows.toggle}
          locations={theirs.length}
          onOpen={(id) => {
            void navigate(`/events/organizations/${id}`, { state: backState });
          }}
        />
        {here
          ? (organization.places ?? [])
              .filter((place) => here.has(place.id) && Boolean(place.note ?? place.url))
              .map((place) => (
                <div key={place.id} className="-mt-1 mb-3 px-1">
                  <PlaceContact place={place} />
                </div>
              ))
          : null}
        {others.length > 0 && onGoTo ? (
          <AlsoIn organization={organization} places={others} onGoTo={onGoTo} />
        ) : null}
      </div>
    );
  });
}

/** An organization's other places, each a button that moves the map there. */
function AlsoIn({
  organization,
  places,
  onGoTo,
}: {
  organization: Organization;
  places: MapOrganization[];
  onGoTo: (place: MapOrganization) => void;
}) {
  const cities = places.map((place) => place.city);
  return (
    <p className="-mt-1 mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 px-1 text-[0.8125rem] text-ink2">
      <span>Also in:</span>
      {places.map((place, index) => {
        // Two in one city say which is which.
        const name =
          place.label && cities.indexOf(place.city) !== cities.lastIndexOf(place.city)
            ? `${place.city} (${place.label})`
            : place.city || (place.label ?? 'another place');
        return (
          <span key={place.placeId} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <button
              type="button"
              onClick={() => {
                onGoTo(place);
              }}
              aria-label={`Show ${organization.name} in ${name} on the map`}
              className="min-h-[44px] px-1 font-semibold text-emphasis underline underline-offset-2"
            >
              {name}
            </button>
          </span>
        );
      })}
    </p>
  );
}
