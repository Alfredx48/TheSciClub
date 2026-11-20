/**
 * Brings an installed app up to date after a deploy, without reinstalling.
 *
 * The service worker already takes over as soon as a new one arrives
 * (`skipWaiting` + `clientsClaim` in src/sw.ts). That left two gaps, and
 * members had to clear the app to get past them:
 *
 * - A browser looks for a new `sw.js` only when a page loads. An installed
 *   app comes back from the background without loading anything, so it
 *   could go days without looking. This asks on every return to the
 *   foreground, and every half hour while the app stays open.
 * - When the new worker took over, the screen kept running the old code
 *   until something reloaded it. This reloads, at a moment that loses
 *   nothing: at once if the app is in the background, or if it has only
 *   just come back and nobody has touched it yet; otherwise the next time
 *   it goes to the background, so a half-typed message is never thrown away.
 *
 * The first worker ever installed also takes over, and that is not an
 * update: a page with no worker in control when it opened does not reload.
 *
 * A pressed notification counts as a touch, for FOLLOW_HOLD_MS (the owner,
 * 2026-11-20: a notification tapped with the app in the background left it
 * where it was, after a deploy). The app coming back usually comes with the
 * press, and the new version taking over a moment later reloaded the screen
 * the press had only just opened. It reloads the next time the app goes to the
 * background instead. Held by the time, not the touch flag, since the press
 * can be heard just before the return that clears that flag.
 *
 * As a last resort (the owner, 2026-11-01: a Home Screen app still old after
 * being closed and opened): each check also reads /version.json, which the
 * worker does not keep. Still behind a minute after noticing, the app empties
 * its copy of the site and reloads from the network, at the same safe moments,
 * and once for each release so a bad deploy cannot loop. The worker itself
 * stays registered: unregistering it would end the member's notifications.
 *
 * Started once from main.tsx, outside React, since it belongs to the page's
 * whole life. Not in the store app, which has no worker and updates from the
 * store.
 */

import { FOLLOWED } from '@/lib/push/payload';
import { isNative } from '@/lib/standalone';

export const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Long enough for the worker to bring the new version in the ordinary way. */
export const GRACE_MS = 60 * 1000;
/** How long after a pressed notification opens the app counts as in use. */
export const FOLLOW_HOLD_MS = 30 * 1000;
const FORCED_KEY = 'club:forced-refresh';

/** The release that is out, or null when it cannot be told. */
async function latestRelease(): Promise<string | null> {
  const response = await fetch('/version.json', { cache: 'no-store' });
  if (!response.ok) return null;
  const { built } = (await response.json()) as { built?: unknown };
  return typeof built === 'string' ? built : null;
}

/** Once for each release, across reloads. */
function mayForce(release: string): boolean {
  try {
    if (localStorage.getItem(FORCED_KEY) === release) return false;
    localStorage.setItem(FORCED_KEY, release);
    return true;
  } catch {
    // Nowhere to remember it: not worth the risk of a loop.
    return false;
  }
}

/** Only the copy of the site: the worker fetches what it no longer holds. */
async function emptySiteCopy(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith('workbox-precache')).map((name) => caches.delete(name)),
  );
}

type Container = Pick<
  ServiceWorkerContainer,
  'controller' | 'getRegistration' | 'addEventListener' | 'removeEventListener'
>;

export function stayCurrent({
  container = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  reload = () => {
    window.location.reload();
  },
  built = import.meta.env.VITE_APP_BUILT,
  latest = latestRelease,
  emptyCopy = emptySiteCopy,
}: {
  container?: Container | undefined;
  reload?: () => void;
  /** This copy's build. Unset under `pnpm dev`, which has no release to be behind. */
  built?: string | undefined;
  latest?: () => Promise<string | null>;
  emptyCopy?: () => Promise<void>;
} = {}): () => void {
  if (!container || isNative()) return () => undefined;
  const sw = container;

  let hadController = sw.controller !== null;
  // A newer version is in control and the screen has not caught up.
  let behind = false;
  // Pressed or typed since the app last came to the foreground.
  let touched = false;
  // When a pressed notification last opened its address.
  let followedAt = Number.NEGATIVE_INFINITY;
  let reloading = false;

  function inUse() {
    return touched || Date.now() - followedAt < FOLLOW_HOLD_MS;
  }

  function catchUp() {
    if (reloading) return;
    reloading = true;
    reload();
  }

  // A release this copy is still behind, and whether the grace has run out.
  let release: string | null = null;
  let stuck = false;
  let grace: number | undefined;

  function force() {
    if (reloading || !release || !mayForce(release)) return;
    reloading = true;
    void emptyCopy()
      .catch(() => undefined)
      .finally(reload);
  }

  function compare() {
    if (!built) return;
    latest()
      .then((out) => {
        if (!out || out === built) return;
        release = out;
        if (grace !== undefined || stuck) return;
        grace = window.setTimeout(() => {
          stuck = true;
          if (document.visibilityState === 'hidden' || !inUse()) force();
        }, GRACE_MS);
      })
      .catch(() => undefined);
  }

  function check() {
    if (document.visibilityState === 'hidden') return;
    void sw
      .getRegistration()
      .then((registration) => registration?.update())
      // Offline, or the deploy is mid-flight: the next check will do.
      .catch(() => undefined);
    compare();
  }

  function onControllerChange() {
    if (!hadController) {
      hadController = true;
      return;
    }
    behind = true;
    if (document.visibilityState === 'hidden' || !inUse()) catchUp();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (behind) catchUp();
      else if (stuck) force();
      return;
    }
    touched = false;
    check();
  }

  function onTouch() {
    touched = true;
  }

  function onFollowed() {
    followedAt = Date.now();
  }

  sw.addEventListener('controllerchange', onControllerChange);
  document.addEventListener('visibilitychange', onVisibility);
  // Capture, so a handler that stops the event does not hide it from here.
  window.addEventListener('pointerdown', onTouch, true);
  window.addEventListener('keydown', onTouch, true);
  window.addEventListener(FOLLOWED, onFollowed);
  const timer = window.setInterval(check, CHECK_EVERY_MS);
  // Opened from cold, no return to the foreground says so.
  compare();

  return () => {
    window.clearTimeout(grace);
    sw.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointerdown', onTouch, true);
    window.removeEventListener('keydown', onTouch, true);
    window.removeEventListener(FOLLOWED, onFollowed);
    window.clearInterval(timer);
  };
}
