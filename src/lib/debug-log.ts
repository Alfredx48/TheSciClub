/**
 * Debug mode, for an administrator (the owner, 2026-11-18: "I want to see the
 * time it takes for the different RPCs to happen. I want to understand why it
 * takes as long to load the home feed").
 *
 * While it is on, every request the app makes to the club is kept here with
 * when it started and how long it took, grouped by the screen it was made on,
 * and the panel (components/debug-panel.tsx) draws them. page-speed.ts already
 * times each request for the speed charts; it tells this log too.
 *
 * On this device only: the switch is in this browser's storage, nothing here
 * is sent anywhere, and it is all gone on a reload. The switch is offered to
 * administrators (Me), and the panel is drawn for them alone.
 */

const KEY = 'sci-club:debug';

const end = (request: DebugRequest) => request.at + request.ms;
const SCREENS_KEPT = 6;
const REQUESTS_KEPT = 300;

export interface DebugRequest {
  /** `rpc:home_topics_ranked`, `table:chat_topics`, `auth:token` (page-speed's endpointOf). */
  endpoint: string;
  /** What it asked, for telling two reads of one table apart. Kept on this device. */
  detail: string;
  /** Milliseconds after the screen was reached. */
  at: number;
  ms: number;
  ok: boolean;
  /** The reply's size, when the server said. */
  bytes: number | null;
}

/** A moment a screen names, and the requests it was waiting for, by endpoint. */
export interface DebugMark {
  label: string;
  /** Milliseconds after the screen was reached. */
  ms: number;
  /** The endpoints it depended on, in the order they are asked. */
  needs: readonly string[];
}

export interface DebugScreen {
  id: number;
  path: string;
  /** `performance.now()` when the screen was reached; 0 is opening the app. */
  startedAt: number;
  /** Reached by opening the app, so its times include the app starting. */
  opened: boolean;
  /** When its cards were drawn with their data, if it said. */
  cardsMs: number | null;
  /**
   * Moments the screen names, each once: "Posts on screen" (the owner,
   * 2026-11-18: "when the user sees the text of the posts").
   */
  marks: readonly DebugMark[];
  requests: readonly DebugRequest[];
}

export interface DebugState {
  enabled: boolean;
  /** Oldest first; the last is the screen now shown. */
  screens: readonly DebugScreen[];
}

function stored(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let state: DebugState = { enabled: typeof window !== 'undefined' && stored(), screens: [] };
const listeners = new Set<() => void>();
let nextId = 1;

function set(next: DebugState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function debugState(): DebugState {
  return state;
}

export function setDebugEnabled(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage refused (a private window): on for this page load all the same.
  }
  set({ enabled, screens: enabled ? state.screens : [] });
}

/** A screen was reached (page-speed's noteScreen). */
export function debugScreen(path: string, startedAt: number, opened: boolean) {
  if (!state.enabled) return;
  const screen: DebugScreen = {
    id: nextId,
    path,
    startedAt,
    opened,
    cardsMs: null,
    marks: [],
    requests: [],
  };
  nextId += 1;
  set({ ...state, screens: [...state.screens, screen].slice(-SCREENS_KEPT) });
}

/** A request finished (page-speed's timedFetch). `started` is `performance.now()` at its start. */
export function debugRequest(
  endpoint: string,
  detail: string,
  started: number,
  ms: number,
  ok: boolean,
  bytes: number | null,
) {
  if (!state.enabled) return;
  // Before any screen was noted: the app's own start.
  const screens =
    state.screens.length > 0
      ? state.screens
      : [
          {
            id: 0,
            path: typeof window === 'undefined' ? '/' : window.location.pathname,
            startedAt: 0,
            opened: true,
            cardsMs: null,
            marks: [],
            requests: [],
          } satisfies DebugScreen,
        ];
  const last = screens[screens.length - 1];
  if (!last || last.requests.length >= REQUESTS_KEPT) return;
  const request: DebugRequest = {
    endpoint,
    detail,
    at: Math.max(0, started - last.startedAt),
    ms,
    ok,
    bytes,
  };
  set({
    ...state,
    screens: [...screens.slice(0, -1), { ...last, requests: [...last.requests, request] }],
  });
}

/**
 * A moment on the screen now shown, named by the screen: once for each name,
 * timed from reaching the screen to now. Ask for it once what it names is
 * painted (`afterPaint`).
 */
export function debugMark(path: string, label: string, needs: readonly string[] = []) {
  if (!state.enabled) return;
  const last = state.screens[state.screens.length - 1];
  if (last?.path !== path || last.marks.some((mark) => mark.label === label)) return;
  const ms = Math.max(0, performance.now() - last.startedAt);
  set({
    ...state,
    screens: [
      ...state.screens.slice(0, -1),
      { ...last, marks: [...last.marks, { label, ms, needs }] },
    ],
  });
}

/**
 * What a moment was made of (the owner, 2026-11-18: "how long it takes for
 * the posts to render and what are the constituent parts"): the wait before
 * the first request it waited for, each request in that chain, any wait
 * between them, and the drawing after the last. Requests that ran beside the
 * chain are not in it, so the parts add up to the moment's own time.
 */
export function markParts(screen: DebugScreen, mark: DebugMark): { label: string; ms: number }[] {
  // What it could have been waiting for: answered by then, and one of the
  // endpoints it names (any, if it names none).
  const candidates = screen.requests.filter(
    (request) =>
      end(request) <= mark.ms && (mark.needs.length === 0 || mark.needs.includes(request.endpoint)),
  );
  const chain = waitedFor(candidates);
  const parts: { label: string; ms: number }[] = [];
  let at = 0;
  for (const request of chain) {
    const gap = request.at - at;
    if (gap >= 1)
      parts.push({ label: at === 0 ? 'before the first request' : 'between requests', ms: gap });
    parts.push({ label: request.endpoint, ms: request.ms });
    at = end(request);
  }
  if (chain.length > 0 && mark.ms - at >= 1)
    parts.push({ label: 'rendering, after the last reply', ms: mark.ms - at });
  return parts;
}

/**
 * Of some requests, the ones that waited for one another, first to last:
 * from the last to answer back, each time to the one that had answered last
 * before this one was asked. Only one that had already answered can have
 * been waited for; the rest ran beside these.
 */
function waitedFor(requests: readonly DebugRequest[]): DebugRequest[] {
  let link = requests.reduce<DebugRequest | null>(
    (last, request) => (last === null || end(request) > end(last) ? request : last),
    null,
  );
  const chain: DebugRequest[] = [];
  while (link) {
    chain.unshift(link);
    const began = link.at;
    link = requests.reduce<DebugRequest | null>(
      (before, request) =>
        end(request) <= began && (before === null || end(request) > end(before)) ? request : before,
      null,
    );
  }
  return chain;
}

/** When the screen now shown was reached (`performance.now()`), or null with debug off. */
export function debugScreenStart(path: string): number | null {
  const last = state.screens[state.screens.length - 1];
  return state.enabled && last?.path === path ? last.startedAt : null;
}

/** Runs `then` once what React has just drawn is on the glass: two frames on. */
export function afterPaint(then: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    then();
    return () => undefined;
  }
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(then);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** The screen's cards were drawn with their data, `ms` after it was reached. */
export function debugCards(path: string, ms: number) {
  if (!state.enabled) return;
  const last = state.screens[state.screens.length - 1];
  if (last?.path !== path || last.cardsMs !== null) return;
  set({ ...state, screens: [...state.screens.slice(0, -1), { ...last, cardsMs: ms }] });
}

export interface DebugSummary {
  count: number;
  failed: number;
  /** How many of them were the screen loading (`loading`), not something later. */
  loadingCount: number;
  /** From reaching the screen to the last reply of its loading. */
  lastReplyMs: number;
  /** Every loading request's time added up: more than `lastReplyMs` when they overlap. */
  addedMs: number;
  /** The loading request that took longest. */
  slowest: DebugRequest | null;
}

/** A second with nothing asked and nothing awaited ends the screen's loading. */
const QUIET_MS = 1000;

/**
 * The requests that were the screen loading: from the first, for as long as
 * each began within a second of everything before it having answered. What
 * comes after a quiet second is something else (a post marked seen once it
 * has been looked at, the badges' count every so often) and is not what the
 * screen waited for: the owner's first list (2026-11-18) said "last reply
 * after 16.66 s" of a Home that had loaded in under two.
 */
export function loading(screen: DebugScreen): DebugRequest[] {
  const inOrder = [...screen.requests].sort((a, b) => a.at - b.at);
  const first: DebugRequest[] = [];
  let busyUntil = 0;
  for (const request of inOrder) {
    if (first.length > 0 && request.at > busyUntil + QUIET_MS) break;
    first.push(request);
    busyUntil = Math.max(busyUntil, end(request));
  }
  return first;
}

export function summarize(screen: DebugScreen): DebugSummary {
  const requests = loading(screen);
  return {
    count: screen.requests.length,
    failed: screen.requests.filter((request) => !request.ok).length,
    loadingCount: requests.length,
    lastReplyMs: requests.reduce((latest, request) => Math.max(latest, end(request)), 0),
    addedMs: requests.reduce((sum, request) => sum + request.ms, 0),
    slowest: requests.reduce<DebugRequest | null>(
      (slow, request) => (slow === null || request.ms > slow.ms ? request : slow),
      null,
    ),
  };
}

/**
 * The requests that waited for one another while the screen loaded, first to
 * last: from its last reply back, each time to the request that had answered
 * last before this one was asked. They are why the screen took as long as it
 * did; the rest ran beside them. Only one that had already answered can have
 * been waited for: a request still out when the next began was not.
 */
export function debugChain(screen: DebugScreen): DebugRequest[] {
  return waitedFor(loading(screen));
}

/** "840 ms", "2.31 s". */
export function debugMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** The screen's requests as text for sharing, without table query details. */
export function debugReport(screen: DebugScreen): string {
  const summary = summarize(screen);
  const rows = [...screen.requests]
    .sort((a, b) => a.at - b.at)
    .map(
      (request) =>
        `+${Math.round(request.at).toString().padStart(5)} ms  ${Math.round(request.ms).toString().padStart(5)} ms  ${request.ok ? '  ' : '✕ '}${request.endpoint}${request.bytes === null ? '' : `  ${request.bytes} bytes`}`,
    );
  const later = summary.count - summary.loadingCount;
  return [
    `${screen.path}${screen.opened ? ' (opening the app)' : ''}`,
    `loading: ${summary.loadingCount} requests, last reply after ${debugMs(summary.lastReplyMs)}, ${debugMs(summary.addedMs)} added up${later > 0 ? `; ${later} more later, in the background` : ''}${summary.failed ? `; ${summary.failed} failed` : ''}`,
    ...screen.marks.flatMap((mark) => [
      `${mark.label} after ${debugMs(mark.ms)}`,
      ...markParts(screen, mark).map(
        (part) => `    ${`${Math.round(part.ms)} ms`.padStart(8)}  ${part.label}`,
      ),
    ]),
    screen.cardsMs === null
      ? 'cards shown: not reported (a tab already open shows its cards at once)'
      : `cards shown after ${debugMs(screen.cardsMs)}`,
    `waited in a row: ${debugChain(screen)
      .map((request) => `${request.endpoint} ${debugMs(request.ms)}`)
      .join(', then ')}`,
    '',
    ' started     took   request',
    ...rows,
  ].join('\n');
}

/** For tests. */
export function resetDebugLog(enabled = false) {
  nextId = 1;
  state = { enabled, screens: [] };
}
