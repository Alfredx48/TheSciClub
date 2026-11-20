/**
 * What a push turns into on the lock screen, and where tapping it goes.
 *
 * Pure, and shared: the service worker imports it to show a notification, and
 * the tests import it without a service worker anywhere near them. `src/sw.ts`
 * is the thin half that touches `self`.
 *
 * ---------------------------------------------------------------------------
 * Every push shows something
 * ---------------------------------------------------------------------------
 * The subscription is `userVisibleOnly`, and Safari has said of the Mac that a
 * push which shows no notification can cost the subscription. The iOS post is
 * silent on it, so this assumes the worst: a payload that is missing, is not
 * JSON, or has no title still produces a notification. The fallback says only
 * that there is new activity — it is what a lock screen says when we do not know
 * what happened, and a lock screen is read by whoever is next to it.
 *
 * ---------------------------------------------------------------------------
 * The sender decides the words, and this does not add any
 * ---------------------------------------------------------------------------
 * What a notification may say — "Bo sent you a message", with or without the
 * message — is the sender's decision and the member's switch, not this file's.
 * So nothing here reaches for a body the payload did not carry.
 *
 * ---------------------------------------------------------------------------
 * The address is ours or it is home
 * ---------------------------------------------------------------------------
 * A tap opens `url`. Anything that is not a path on this origin — another
 * site, `javascript:`, a protocol-relative `//elsewhere` — becomes `/`. The
 * sender is ours, but a notification that can open an arbitrary address is a
 * phishing page one bug away.
 */

export interface PushNotification {
  title: string;
  /**
   * The number for the app icon, when the push carried one — message pushes
   * do, with the recipient's unread conversations. Absent means leave it.
   */
  badge?: number;
  options: {
    body?: string;
    tag?: string;
    icon: string;
    data: { url: string };
  };
}

/** The lock screen's words when a push arrives without any we can use. */
export const FALLBACK_TITLE = 'New activity';

const ICON = '/favicon-192x192.png';

/**
 * A path on this origin, or `/`.
 *
 * Returns path, query and hash, never an absolute URL, so the caller cannot
 * end up somewhere else by joining it to the wrong base.
 */
export function safePath(candidate: unknown, origin: string): string {
  if (typeof candidate !== 'string' || candidate === '') return '/';
  let resolved: URL;
  try {
    resolved = new URL(candidate, origin);
  } catch {
    return '/';
  }
  if (resolved.origin !== origin) return '/';
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The notification a push's body describes.
 *
 * `raw` is `PushEvent.data?.text()` — a string, or null when the push carried
 * nothing. Never throws: a notification must be shown whatever arrived.
 */
export function readPushPayload(raw: string | null | undefined, origin: string): PushNotification {
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const fields: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};

  const title = text(fields.title);
  const body = text(fields.body);
  const tag = text(fields.tag);

  const badge = fields.badge;
  return {
    title: title ?? FALLBACK_TITLE,
    ...(typeof badge === 'number' && Number.isInteger(badge) && badge >= 0 ? { badge } : {}),
    options: {
      // exactOptionalPropertyTypes: an absent key, not `body: undefined`.
      ...(body ? { body } : {}),
      ...(tag ? { tag } : {}),
      icon: ICON,
      data: { url: safePath(fields.url, origin) },
    },
  };
}

/**
 * Which open window a tap should bring forward, by index, or null to open one.
 *
 * One already showing the address wins, because it needs no navigation and
 * keeps whatever the member had typed. Then the focused one, then any. The
 * installed app is one window almost always; the order matters on a desktop
 * with the club in two tabs.
 */
export function pickWindow(
  windows: readonly { url: string; focused: boolean }[],
  path: string,
  origin: string,
): number | null {
  if (windows.length === 0) return null;
  const at = windows.findIndex((w) => safePath(w.url, origin) === path);
  if (at !== -1) return at;
  const focused = windows.findIndex((w) => w.focused);
  return focused !== -1 ? focused : 0;
}

/**
 * The service worker asks the app to open a notification's address itself,
 * with these two messages, rather than reloading the window at it.
 *
 * `WindowClient.navigate()` reloads the whole app (and has not been reliable
 * in Safari, which is most of the club's installed apps), so a press on a
 * notification while the club was already open could focus it and leave it
 * where it was. The app's router changes screen instantly instead, and says
 * so; only when it does not answer does the worker fall back to navigate().
 *
 * PENDING is the other way round, for a window that is only now starting: an
 * installed iPhone app opened from a notification can start on its home
 * screen rather than the address it was given, so a starting app asks the
 * worker whether a press is waiting for it.
 */
export const NAVIGATE = 'club:navigate';
/**
 * A window event: the app has just opened a pressed notification's address.
 * stay-current holds a version reload back for a while after it, as after a
 * touch, so the reload cannot take the member back where they were.
 */
export const FOLLOWED = 'club:notification-followed';
export const PENDING = 'club:pending-navigation';
/** How long a press waits for a starting window to collect it. */
export const PENDING_FOR_MS = 20_000;

/** The address a message from the service worker asks the app to open, or null. */
export function navigationRequest(data: unknown, origin: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, path } = data as { type?: unknown; path?: unknown };
  if (type !== NAVIGATE || typeof path !== 'string') return null;
  return safePath(path, origin);
}
