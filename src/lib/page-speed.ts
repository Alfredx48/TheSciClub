import { matchPath } from 'react-router-dom';
import { debugCards, debugRequest, debugScreen } from '@/lib/debug-log';

/**
 * How fast the app is for the people using it (the owner, 2026-11-04;
 * 20261104010000).
 *
 * Each page load reports its own timings once (first byte, first paint,
 * largest paint, ready), and every request to the club reports how long it
 * took, named by what it asked for and never with its arguments. Nothing
 * identifies anybody: the screen is its pattern, and a random id groups one
 * visit. Each sample says which release took it (the owner, 2026-11-21), so a
 * release that made the app slower stands out beside the one before it.
 *
 * Sent only when the page is put away (the owner, 2026-11-21: measuring every
 * visit had been thought to slow the app), so a report never competes with a
 * screen that is loading. Sent with keepalive, so it still goes as the app
 * closes, and dropped quietly if sending fails.
 */

/** The app's screens (App.tsx), so an address is kept only as its pattern. */
const SCREENS = [
  '/',
  '/admin',
  '/anonymous',
  '/app-sign-in',
  '/chat',
  '/chat/new',
  '/chat/new-group',
  '/chat/rooms/new',
  '/chat/rooms/:id',
  '/chat/rooms/:id/new',
  '/chat/rooms/:id/topics/:id',
  '/chat/t/:id',
  '/chat/t/:id/members',
  '/delete-account',
  '/e/:id',
  '/e/:id/register',
  '/events',
  '/events/new',
  '/events/invites',
  '/events/organizations/:id',
  '/events/organizations/:id/review',
  '/events/:id',
  '/events/:id/check-in',
  '/events/:id/check-ins',
  '/events/:id/edit',
  '/events/:id/guests',
  '/events/:id/review',
  '/home',
  '/home/new',
  '/introductions/:id',
  '/invites',
  '/join',
  '/me',
  '/me/qr',
  '/notifications',
  '/organizations/manage',
  '/partner',
  '/peers',
  '/peers/:id',
  '/privacy',
  '/profile',
  '/profile/answers',
  '/profile/details',
  '/request-invite',
  '/reset-password',
  '/share',
  '/stats',
  '/terms',
];

/** The screen an address is, as its pattern: /events/:id, never which one. */
export function screenOf(pathname: string): string {
  for (const pattern of SCREENS) {
    if (matchPath({ path: pattern, end: true }, pathname)) return pattern;
  }
  return '/other';
}

/**
 * What a request to the club asked for, without its arguments: an rpc or a
 * table by name, auth or a function by its step, storage as one.
 */
export function endpointOf(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const parts = path.split('/').filter(Boolean);
  const [service, , kind, name] = parts;
  if (service === 'rest') {
    if (kind === 'rpc' && name) return `rpc:${name}`;
    return kind ? `table:${kind}` : null;
  }
  if (service === 'auth') return `auth:${kind ?? ''}`;
  if (service === 'functions') return kind ? `fn:${kind}` : null;
  if (service === 'storage') return 'storage';
  return null;
}

interface Sample {
  visit: string;
  kind: 'load' | 'request';
  screen: string;
  metric: string;
  ms: number;
  ok: boolean;
  /**
   * Why a request failed: the server's status ("401", "500"), or "no
   * connection" when it never answered (the owner, 2026-11-21). Absent when
   * it worked. A request cancelled by leaving the screen is not recorded at
   * all: it did not fail, nobody was waiting for it.
   */
  failure?: string;
  installed: boolean;
  mobile: boolean;
  connection: string | null;
  /** The build's minute (VITE_APP_BUILT), tagged in git as release-<minute>. */
  release: string;
}

/** Which release this is; '' in a test or a dev server. */
const RELEASE = import.meta.env.VITE_APP_BUILT ?? '';

/**
 * One visit in this many is measured, decided once per page load (the owner,
 * 2026-11-05: 1 in 10 on the free plan; 2026-11-21: 1 in 3 again, now that
 * nothing is sent while a screen loads).
 */
export const ONE_VISIT_IN = 3;

/** Whether this page load is measured: random, one in ONE_VISIT_IN. */
export function measuredVisit(random: () => number = Math.random): boolean {
  return random() * ONE_VISIT_IN < 1;
}

/** Enough to see a pattern; past it, a long visit stops reporting requests. */
const MAX_REQUESTS_PER_VISIT = 300;
/** log_page_speed takes at most this many a call. */
const BATCH = 50;
const LOG_RPC = 'log_page_speed';

type Sender = (samples: Sample[]) => Promise<unknown>;

let sender: Sender | null = null;
let queue: Sample[] = [];
let requestsSeen = 0;
let skipped = false;
const visit = randomId();

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function context(): Pick<Sample, 'installed' | 'mobile' | 'connection' | 'release'> {
  let installed = false;
  try {
    installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    // Unknown counts as the browser.
  }
  const connection =
    (navigator as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null;
  return {
    installed,
    mobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
    connection,
    release: RELEASE,
  };
}

function push(sample: Omit<Sample, 'visit' | 'installed' | 'mobile' | 'connection' | 'release'>) {
  if (skipped) return;
  if (!Number.isFinite(sample.ms) || sample.ms < 0) return;
  queue.push({ ...sample, ms: Math.round(sample.ms), visit, ...context() });
}

/**
 * Sends everything waiting, in calls of BATCH. Only when the page is put away
 * (and in tests). Failures are dropped: speed is never worth an error.
 */
export function flush(): void {
  if (!sender) return;
  while (queue.length > 0) {
    const batch = queue.slice(0, BATCH);
    queue = queue.slice(BATCH);
    try {
      void sender(batch).catch(() => undefined);
    } catch {
      // An unconfigured client throws at once; dropped all the same.
    }
  }
}

/**
 * A fetch for the club's client that times each request. The log's own call
 * is not timed, or every batch would make the next.
 */
export function timedFetch(base: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const endpoint = endpointOf(url);
    // The log's own call goes with keepalive, so it is still sent as the app closes.
    if (endpoint === `rpc:${LOG_RPC}`) return base(input, { ...init, keepalive: true });
    if (!endpoint) return base(input, init);
    const started = performance.now();
    // Push subscription filters can carry delivery endpoints.
    const detail =
      endpoint.startsWith('table:') && endpoint !== 'table:push_subscriptions'
        ? whatWasAsked(url)
        : '';
    try {
      const response = await base(input, init);
      const ms = performance.now() - started;
      const length = Number(response.headers.get('content-length'));
      debugRequest(
        endpoint,
        detail,
        started,
        ms,
        response.ok,
        Number.isFinite(length) && length > 0 ? length : null,
      );
      record(endpoint, ms, response.ok, response.ok ? undefined : String(response.status));
      return response;
    } catch (thrown) {
      const ms = performance.now() - started;
      debugRequest(endpoint, detail, started, ms, false, null);
      if (!cancelled(thrown, init)) record(endpoint, ms, false, 'no connection');
      throw thrown;
    }
  };
}

/** A read's own words, shortened: which columns, filters and order. */
function whatWasAsked(url: string): string {
  try {
    const asked = decodeURIComponent(new URL(url).search.slice(1));
    return asked.length > 160 ? `${asked.slice(0, 159)}…` : asked;
  } catch {
    return '';
  }
}

/** Called off by the app (leaving a screen), rather than failed. */
function cancelled(thrown: unknown, init: RequestInit | undefined): boolean {
  return (
    (thrown instanceof DOMException && thrown.name === 'AbortError') ||
    init?.signal?.aborted === true
  );
}

function record(endpoint: string, ms: number, ok: boolean, failure?: string) {
  if (skipped || requestsSeen >= MAX_REQUESTS_PER_VISIT) return;
  requestsSeen += 1;
  push({
    kind: 'request',
    screen: screenOf(window.location.pathname),
    metric: endpoint,
    ms,
    ok,
    ...(failure ? { failure } : {}),
  });
}

/**
 * Starts reporting: the load's own timings once it has settled, and every
 * request from then on. `send` is the club's log call; it is given rather
 * than imported so the club's client can use timedFetch without a cycle.
 * Most visits are not measured (ONE_VISIT_IN), and send nothing.
 */
export function startPageSpeed(send: Sender, measured = measuredVisit()): void {
  if (!measured) {
    skipped = true;
    queue = [];
    return;
  }
  sender = send;
  const screen = screenOf(window.location.pathname);

  let largestPaint: number | null = null;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) largestPaint = last.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // Safari has no largest paint; the other timings still go.
  }

  // Once: after the load has settled, or sooner if the app is put away first
  // (the owner, 2026-11-21: a quick look at the app sent no opening times).
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    const firstPaint = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    // A time not reached yet is 0: put away before the page was ready.
    if (navigation && navigation.responseStart > 0) {
      push({ kind: 'load', screen, metric: 'first-byte', ms: navigation.responseStart, ok: true });
    }
    if (navigation && navigation.domContentLoadedEventEnd > 0) {
      push({
        kind: 'load',
        screen,
        metric: 'ready',
        ms: navigation.domContentLoadedEventEnd,
        ok: true,
      });
    }
    if (firstPaint) {
      push({ kind: 'load', screen, metric: 'first-paint', ms: firstPaint.startTime, ok: true });
    }
    if (largestPaint !== null) {
      push({ kind: 'load', screen, metric: 'largest-paint', ms: largestPaint, ok: true });
    }
  };

  // Settled: some seconds after load, so the largest paint has happened.
  const afterLoad = () => setTimeout(report, 5000);
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad, { once: true });

  // Everything goes when the page is put away or closed, never while in use.
  // The opening's own times go too if they have not yet.
  const putAway = () => {
    report();
    flush();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') putAway();
  });
  window.addEventListener('pagehide', putAway);
}

/*
 * Cards shown (the owner, 2026-11-04): how long until a screen's cards are
 * on screen with their data, not its loading placeholders. Timed two ways:
 * from opening the app (cards-after-open), and from moving to the screen
 * inside it (cards-after-tap). A screen kept loaded and gone back to shows
 * its cards at once and is not timed.
 */

interface ScreenVisit {
  path: string;
  /** performance.now() when the screen was reached; 0 is opening the app. */
  at: number;
  opened: boolean;
  done: boolean;
  /** The page was put away meanwhile, so the time says nothing. */
  hidden: boolean;
}

let current: ScreenVisit | null = null;
let touched = false;
/** When somebody last tapped or pressed a key, for the start of a move. */
let lastInput: number | null = null;

function watchVisit() {
  const touch = (event: Event) => {
    touched = true;
    lastInput = event.timeStamp;
  };
  window.addEventListener('pointerdown', touch, { capture: true, passive: true });
  window.addEventListener('keydown', touch, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && current) current.hidden = true;
  });
}

/**
 * Called as the address changes (App.tsx). Until somebody has touched the
 * app, a new address is still the opening: a redirect from / to /home is
 * not a tap.
 */
export function noteScreen(pathname: string): void {
  if (current?.path === pathname) return;
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (current === null || (!touched && current.opened && !current.done)) {
    if (current === null && typeof window !== 'undefined') watchVisit();
    current = { path: pathname, at: 0, opened: true, done: false, hidden };
    debugScreen(pathname, 0, true);
    return;
  }
  // From the tap that led here, not from when the screen took over: a
  // screen's script loads first, with the last screen still up.
  const now = performance.now();
  // A browser that stamps events from 1970 rather than from the page's
  // start gives a time past now; the move then starts here.
  const at = lastInput !== null && lastInput <= now && now - lastInput < 10_000 ? lastInput : now;
  current = { path: pathname, at, opened: false, done: false, hidden };
  debugScreen(pathname, at, false);
}

/**
 * Called once a screen's cards are drawn with their data. Timed at the next
 * frame after, which is when they are painted.
 */
let firstShown: (() => void) | null = null;
const firstContent = new Promise<void>((done) => {
  firstShown = done;
});

/**
 * Resolves once the first screen shows its content (or after `fallbackMs`),
 * so work that can wait, such as fetching the other tabs' scripts, does not
 * compete with it (the owner, 2026-11-21: on a slow phone the other tabs'
 * scripts started while Home's feed was being drawn).
 */
export function afterFirstContent(fallbackMs = 8000): Promise<void> {
  return Promise.race([firstContent, new Promise<void>((done) => setTimeout(done, fallbackMs))]);
}

export function cardsShown(): void {
  firstShown?.();
  firstShown = null;
  const visit = current;
  if (!visit || visit.done || visit.path !== window.location.pathname) return;
  visit.done = true;
  const finish = () => {
    debugCards(visit.path, performance.now() - visit.at);
    if (visit.hidden || document.visibilityState === 'hidden') return;
    push({
      kind: 'load',
      screen: screenOf(visit.path),
      metric: visit.opened ? 'cards-after-open' : 'cards-after-tap',
      ms: performance.now() - visit.at,
      ok: true,
    });
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
  } else finish();
}

/** For tests. */
export function resetPageSpeed(): void {
  sender = null;
  queue = [];
  requestsSeen = 0;
  skipped = false;
  current = null;
  touched = false;
  lastInput = null;
}
