import { ChevronLeft } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { litTab } from '@/components/lit-tab';
import {
  arrive,
  currentTrail,
  isTabRoot,
  sayNext,
  subscribeTrail,
  TAB_ROOTS,
} from '@/lib/back-trail';
import { cn } from '@/lib/utils';

/**
 * The way back on every deeper screen: "‹ Life stories", the screen the
 * member was on, one press back (the owner, 2026-11-18). Each screen draws it
 * in its own place (the owner, 2026-11-21: no bar only for back); from that
 * day there is no line across the top, not even while a screen loads.
 *
 * Where it goes is lib/back-trail.ts. With nothing remembered (a screen
 * opened from a notification, a shared link or a refresh) it goes where the
 * screen's own back link went (`OwnBack`); a screen that says nothing goes to
 * its tab.
 */

/** True under the shell that draws the line, so a screen leaves its own link out. */
const LinedContext = createContext(false);

export function BackLineProvider({ children }: { children: ReactNode }) {
  return <LinedContext.Provider value={true}>{children}</LinedContext.Provider>;
}

// ---------------------------------------------------------------------------
// Where the screen itself says back goes
// ---------------------------------------------------------------------------

interface Parent {
  to: string;
  label: string;
  state?: unknown;
}

let parent: Parent | null = null;
const parentListeners = new Set<() => void>();

function setParent(next: Parent | null) {
  parent = next;
  for (const listener of parentListeners) listener();
}

function subscribeParent(listener: () => void): () => void {
  parentListeners.add(listener);
  return () => {
    parentListeners.delete(listener);
  };
}

/**
 * A screen's own back link. Drawn as it always was where there is no line
 * (a screen on its own, outside the member's shell). Under the shell it is
 * drawn in the same place but goes back along the trail, and the line is left
 * out (the owner, 2026-11-21: no bar only for back); it also says where back
 * goes when nothing is remembered.
 */
export function OwnBack({
  to,
  label,
  state,
  className,
  children,
}: Parent & { spacer?: boolean; className?: string; children: ReactNode }) {
  const lined = useClaimLine({ to, label, state });
  const step = useBackStep();
  if (!lined || !step) return children;
  return <InlineBack step={step} className={className} />;
}

/**
 * Back at the top of a screen with no back link of its own, in place of the
 * line; back along the trail, or to the screen's tab. Nothing outside the shell.
 */
export function ScreenBack() {
  const lined = useClaimLine(null);
  const step = useBackStep();
  if (!lined || !step) return null;
  return <InlineBack step={step} />;
}

function InlineBack({
  step,
  className,
}: {
  step: { label: string; back: () => void };
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={step.back}
      aria-label={`Back to ${step.label}`}
      data-target="small"
      className={cn(
        '-ml-1.5 inline-flex min-h-[36px] min-w-0 max-w-full items-center gap-0.5 self-start py-1.5 text-left font-semibold text-[0.875rem] text-emphasis',
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4 flex-none" strokeWidth={2.5} aria-hidden="true" />
      <span className="truncate">{shortName(step.label)}</span>
    </button>
  );
}

/** Under the shell: says where back goes, and keeps the line out while mounted. */
function useClaimLine(own: Parent | null): boolean {
  const lined = useContext(LinedContext);
  const to = own?.to;
  const label = own?.label;
  const state = own?.state;
  useLayoutEffect(() => {
    if (!lined) return;
    const mine: Parent | null =
      to !== undefined && label !== undefined ? { to, label, state } : null;
    if (mine) setParent(mine);
    return () => {
      if (mine && parent === mine) setParent(null);
    };
  }, [lined, to, label, state]);
  return lined;
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

/**
 * A long name, cut at a word: a post's whole title across the line read as
 * the heading of the screen it was on (screenshot review, 2026-11-18). The
 * button's own name, for a screen reader, is the whole of it.
 */
export function shortName(name: string, longest = 32): string {
  if (name.length <= longest) return name;
  const cut = name.slice(0, longest + 1);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > longest / 2 ? at : longest).replace(/[\s:;,.–—-]+$/, '')}…`;
}

/** Each history entry's key by its place in the browser's history. */
const keyAt = new Map<number, string>();

function historyIndex(): number | null {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === 'number' ? index : null;
}

/** Keeps the trail: one, for the whole app, above the routes. */
export function BackTrail() {
  const location = useLocation();
  const move = useNavigationType();
  // Before the title is read from the new screen's heading (RouteChange).
  useLayoutEffect(() => {
    const index = historyIndex();
    if (index !== null) keyAt.set(index, location.key);
    arrive(
      {
        key: location.key,
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      },
      move,
      litTab(location.pathname, location.state),
    );
    // They change together, with the history entry; arriving twice at one
    // entry changes nothing.
  }, [location.key, location.pathname, location.search, location.state, move]);
  return null;
}

/** Where back goes from here, and the step there; null on a tab's first screen. */
function useBackStep(): { label: string; back: () => void } | null {
  const location = useLocation();
  const navigate = useNavigate();
  const trail = useSyncExternalStore(subscribeTrail, currentTrail, currentTrail);
  const own = useSyncExternalStore(
    subscribeParent,
    () => parent,
    () => parent,
  );
  if (isTabRoot(location.pathname)) return null;

  const before = trail.at(-2);
  const tab = litTab(location.pathname, location.state) ?? '/home';
  const fallback: Parent = own ?? { to: tab, label: TAB_ROOTS[tab] ?? 'Home' };
  const label = before ? (before.name ?? 'Back') : fallback.label;

  function back() {
    sayNext('back');
    if (!before) {
      void navigate(fallback.to, { state: fallback.state });
      return;
    }
    // The screen's own way there, when it has something to hand back: a
    // review to return to on the page it was opened from (events/back.ts).
    if (own?.state !== undefined && own.to.split(/[?#]/)[0] === before.pathname) {
      void navigate(own.to, { state: own.state });
      return;
    }
    // The browser's own step back when that is the same screen: its history
    // then stays a straight line. Otherwise there, by a new step.
    const index = historyIndex();
    if (index !== null && index > 0 && keyAt.get(index - 1) === before.key) {
      void navigate(-1);
      return;
    }
    void navigate(`${before.pathname}${before.search}`, { state: before.state });
  }
  return { label, back };
}

/**
 * The way back as an arrow at the start of a screen's own header, in place of
 * the line (the owner, 2026-11-21: a conversation's back beside the name, with
 * no row of its own). Outside the shell, a link to `to`, as BackLink.
 */
export function HeaderBack({ to, label, className: extra }: Parent & { className?: string }) {
  const lined = useClaimLine({ to, label });
  const step = useBackStep();
  const className = cn(
    '-ml-2.5 flex h-[44px] w-[36px] flex-none items-center justify-center rounded-full text-emphasis hover:bg-tint',
    extra,
  );
  const arrow = <ChevronLeft className="h-[24px] w-[24px]" strokeWidth={2.5} aria-hidden="true" />;
  if (!lined || !step) {
    return (
      <Link to={to} aria-label={`Back to ${label}`} className={className}>
        {arrow}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={step.back}
      aria-label={`Back to ${step.label}`}
      title={`Back to ${step.label}`}
      className={className}
    >
      {arrow}
    </button>
  );
}
