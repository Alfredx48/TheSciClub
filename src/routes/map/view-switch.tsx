import { List, MapPin } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { loadMapCanvas } from '@/lib/map';
import { noteMapUsed } from '@/lib/map-used';
import { cn } from '@/lib/utils';
import type * as ClubMapModule from '@/routes/map/club-map';

/**
 * List or Map, at the top of Events and Peers (the owner, 2026-10-25). In the
 * address as `?view=map`, replaced rather than pushed, as the segment is, so a
 * refresh or a back from a detail page comes back to the map.
 */
export type ListOrMap = 'list' | 'map';

/**
 * Only on the screen's own path: Events and Peers both stay mounted (KeptTabs),
 * and the hidden one must not open a map for the other's `?view=map`.
 */
export function useListOrMap(path: string): [ListOrMap, (next: ListOrMap) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const here = pathname === path || pathname === `${path}/`;
  const view: ListOrMap = here && params.get('view') === 'map' ? 'map' : 'list';
  // Shown, however it was reached (the switch, a link, a refresh): from now on
  // Peers and Events fetch the map ahead (prefetchMap).
  useEffect(() => {
    if (view === 'map') noteMapUsed();
  }, [view]);
  const setView = useCallback(
    (next: ListOrMap) => {
      setParams(
        (current) => {
          if (next === 'map') current.set('view', 'map');
          else current.delete('view');
          return current;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [view, setView];
}

let clubMap: Promise<typeof ClubMapModule> | undefined;

/**
 * One read shared by the preload and the lazy screens; a failed one is asked
 * again. Each caller gets a promise of its own: React marks one it has seen as
 * settled, and a second screen's lazy handed that same promise replayed forever.
 */
export function loadClubMap(): Promise<typeof ClubMapModule> {
  clubMap ??= import('@/routes/map/club-map').catch((error: unknown) => {
    clubMap = undefined;
    throw error;
  });
  return clubMap.then((module) => module);
}

/** The map's screen and MapLibre together, so neither waits for the other. */
export function preloadMap(): void {
  void loadClubMap().catch(() => undefined);
  void loadMapCanvas().catch(() => undefined);
}

/**
 * The one showing is its icon, and the other its icon and its word, a pill to
 * press (the owner, 2026-11-01): the word is on the thing there is to do, and
 * it leaves room beside it on a phone.
 */
export function ViewSwitch({
  view,
  onChange,
  className,
}: {
  view: ListOrMap;
  onChange: (next: ListOrMap) => void;
  className?: string;
}) {
  const option = (value: ListOrMap, label: string, Icon: typeof List) => (
    <button
      type="button"
      aria-pressed={view === value}
      aria-label={label}
      onClick={() => {
        onChange(value);
      }}
      // On a phone a touch's pointerdown comes before the click: the map's script starts then.
      {...(value === 'map'
        ? { onPointerEnter: preloadMap, onPointerDown: preloadMap, onFocus: preloadMap }
        : {})}
      className={cn(
        'flex min-h-[44px] items-center gap-1.5 rounded-full font-semibold text-[0.84375rem] transition-colors',
        view === value ? 'min-w-[44px] justify-center' : 'px-3.5',
        view === value ? 'bg-action text-white hover:bg-action-hi' : 'text-ink2 hover:bg-line',
      )}
    >
      <Icon aria-hidden="true" className="h-[16px] w-[16px]" strokeWidth={2.2} />
      {view === value ? null : label}
    </button>
  );
  return (
    // A group, not a fieldset: Safari measured a fieldset narrower than its
    // buttons, so the row did not wrap and Map ran off a phone at a larger
    // text size (the owner, 2026-11-06).
    // biome-ignore lint/a11y/useSemanticElements: Safari lays out a fieldset in a wrapping row too narrow; the group keeps its name.
    <div
      role="group"
      aria-label="Show as"
      className={cn('flex flex-none rounded-full bg-tint p-0.5', className)}
    >
      {option('list', 'List', List)}
      {option('map', 'Map', MapPin)}
    </div>
  );
}
