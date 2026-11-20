/**
 * The way back: the screens a member came through since the last tab, so the
 * line at the top of a deeper screen (components/back-line.tsx) names the one
 * they were on and goes there.
 *
 * The owner, 2026-11-18: "a back button that takes you back to the previous
 * page you were on. It disappears when someone clicks the navigation tab on
 * the bottom [...] as they navigate down the app, there should be an easy way
 * to get back where they came from", drawn as the thin line an iPhone puts at
 * the top with the name of the previous app.
 *
 * Until then each screen had its own back link to a parent worked out from
 * the address: a profile opened from a post went "back" to Peers. Those links
 * still say where back goes when nothing is remembered: a screen opened from
 * a notification, a shared link or a refresh (`OwnBack`, back-line.tsx).
 *
 * In memory only, for this visit, and forgotten on sign-out.
 *
 * ---------------------------------------------------------------------------
 * The rules, in `nextTrail`
 * ---------------------------------------------------------------------------
 * - One of the five tabs' first screens starts a new trail there. It has no
 *   line: there is nowhere further back.
 * - A screen opened from another is added to the end.
 * - Going to the screen before this one, however it is done (the line, a
 *   link on the page that happens to lead there, the browser's or phone's
 *   own back), takes this one off the end rather than adding the old one
 *   again, so two screens never bounce between each other.
 * - A screen that replaces another (a form that becomes what it made) takes
 *   its place.
 * - A tab pressed opens that tab's first screen (app-nav.tsx; Chat too since
 *   2026-11-19), so the first rule covers it. Were a tab to go back where it
 *   was left again, the trail that led there is put back with it.
 */

export const TAB_ROOTS: Readonly<Record<string, string>> = {
  '/home': 'Home',
  '/peers': 'Peers',
  '/chat': 'Chat',
  '/events': 'Events',
  '/me': 'Me',
};

export interface Step {
  /** The router's key for the history entry, to recognise its own back. */
  key: string;
  pathname: string;
  search: string;
  state: unknown;
  /** The screen's heading while it was shown, or null if it never had one. */
  name: string | null;
}

export type Arrival = Pick<Step, 'key' | 'pathname' | 'search' | 'state'>;

/** How the member got to a screen. */
export interface How {
  move: 'PUSH' | 'POP' | 'REPLACE';
  /** By pressing a tab. */
  tab?: boolean;
  /** By pressing the line. */
  back?: boolean;
  /** The trail that tab was left with, for a tab pressed. */
  kept?: readonly Step[] | undefined;
}

const LONGEST = 40;

function root(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return path in TAB_ROOTS ? path : null;
}

/** Whether a screen is one of the five tabs' first screens. */
export function isTabRoot(pathname: string): boolean {
  return root(pathname) !== null;
}

function step(to: Arrival, name: string | null = null): Step {
  return { key: to.key, pathname: to.pathname, search: to.search, state: to.state, name };
}

/** The trail after arriving at `to`. Pure: see the rules in the header. */
export function nextTrail(trail: readonly Step[], to: Arrival, how: How): Step[] {
  const tab = root(to.pathname);
  if (tab) return [step(to, TAB_ROOTS[tab] ?? null)];

  const top = trail.at(-1);
  const before = trail.at(-2);

  if (how.tab) {
    const kept = how.kept ?? [];
    return kept.at(-1)?.pathname === to.pathname
      ? [...kept.slice(0, -1), { ...step(to), name: kept.at(-1)?.name ?? null }]
      : [step(to)];
  }

  // The browser's or the phone's back and forward, to a screen on the trail.
  if (how.move === 'POP') {
    const at = trail.findLastIndex((each) => each.key === to.key);
    if (at >= 0) return trail.slice(0, at + 1);
  }

  // The same screen again: a filter or a reply in its address, not a new place.
  if (top?.pathname === to.pathname) {
    return [...trail.slice(0, -1), { ...step(to), name: top.name }];
  }

  // Back to the screen before this one, by any road.
  if (before?.pathname === to.pathname) {
    return [...trail.slice(0, -2), { ...step(to), name: before.name }];
  }

  // The line, with nothing remembered: the screen's own parent, fresh.
  if (how.back) return [step(to)];

  if (how.move === 'REPLACE' && top) return [...trail.slice(0, -1), step(to)];

  const longer = [...trail, step(to)];
  return longer.length > LONGEST ? longer.slice(longer.length - LONGEST) : longer;
}

// ---------------------------------------------------------------------------
// The one trail, and the ones the tabs were left with
// ---------------------------------------------------------------------------

let trail: readonly Step[] = [];
const kept = new Map<string, readonly Step[]>();
const listeners = new Set<() => void>();
/** What the next arrival was, said by whoever caused it, and when. */
let said: { what: 'tab' | 'back'; at: number } | null = null;

function changed() {
  for (const listener of listeners) listener();
}

export function subscribeTrail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentTrail(): readonly Step[] {
  return trail;
}

/** A tab was pressed, or the line: the arrival that follows is that. */
export function sayNext(what: 'tab' | 'back') {
  said = { what, at: Date.now() };
}

/**
 * The member arrived somewhere. `tab` is the tab that screen lights
 * (`litTab`), which is what its place is remembered under.
 */
export function arrive(to: Arrival, move: How['move'], tab: string | null) {
  // A press that went nowhere (the lit tab on its own first screen) is not
  // the next arrival's, a second later.
  const how = said && Date.now() - said.at < 2000 ? said.what : null;
  said = null;
  trail = nextTrail(trail, to, {
    move,
    tab: how === 'tab',
    back: how === 'back',
    kept: tab ? kept.get(tab) : undefined,
  });
  if (tab) kept.set(tab, trail);
  changed();
}

/** The heading of the screen now shown, as it draws and changes. */
export function nameScreen(heading: string | null | undefined) {
  const top = trail.at(-1);
  const name = heading?.trim();
  if (!top || !name || isTabRoot(top.pathname) || top.name === name) return;
  const named = [...trail.slice(0, -1), { ...top, name }];
  for (const [tab, steps] of kept) if (steps === trail) kept.set(tab, named);
  trail = named;
  changed();
}

export function forgetTrail() {
  trail = [];
  kept.clear();
  said = null;
  changed();
}
