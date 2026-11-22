/**
 * The service worker, written by hand since notifications needed a place to go.
 *
 * Until 2026-09-27 VitePWA generated this (`generateSW`) and there was nowhere
 * to put a `push` handler. It is `injectManifest` now, and the first four
 * statements below are exactly what the generated one did — read `dist/sw.js`
 * from an older build to see them minified. Dropping any of them changes
 * something that worked without saying so:
 *
 * - `skipWaiting` + `clientsClaim` are what `registerType: 'autoUpdate'` means.
 *   Without them a new deploy waits until every tab of the old one is closed,
 *   and an installed app is almost never closed.
 * - `precacheAndRoute` is the offline shell.
 * - The navigation route serves `index.html` for every path, which is what
 *   makes `/chat` open offline rather than only `/`. It is the service worker's
 *   version of the SPA redirect in netlify.toml.
 *
 * Built as an IIFE (see vite.config.ts) so it registers as a classic script;
 * module service workers arrived late on iOS and this is for iPhones.
 *
 * The decisions about what a notification says live in `lib/push/payload.ts`,
 * which is pure and tested. This file only hands events to it.
 */

/// <reference lib="webworker" />

import { clientsClaim, copyResponse } from 'workbox-core';
import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  NAVIGATE,
  PENDING,
  PENDING_FOR_MS,
  pickWindow,
  readPushPayload,
  safePath,
} from './lib/push/payload';
import { SHARE_CACHE, SHARE_MAX_FILES, SHARE_META, shareFileKey } from './lib/share-target';

declare const self: ServiceWorkerGlobalScope;

void self.skipWaiting();
clientsClaim();
// A page fetched after a redirect is handed on as a plain copy: Safari will not show one the
// worker serves with its redirect still on it ("Response served by service worker has
// redirections"; the owner, 2026-11-21, after Cloudflare redirected /index.html to /).
addPlugins([
  {
    fetchDidSucceed: async ({ response }) =>
      response.redirected ? await copyResponse(response) : response,
  },
]);
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Not for an address that is a file. Opened in a tab, an image is a
// navigation too, and served index.html it became the app, which sent it to
// /join: the screenshots opened from the old text-message registration
// (public/sms-opt-in/, since removed) did exactly that in any tab that had been
// to the club first. A path that ends in an extension goes to the network.
// One route has a dot on purpose: /auth/confirm.html, the emailed links' page,
// so the network's newest app answers it, never an older cached one.
// /embed/ is the store app's YouTube page, whose ?v= hides its extension here.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/\.[a-z0-9]+$/i, /^\/embed\//],
  }),
);

// The map's script, worker, glyphs and sprites: left out of the precache
// (vite.config.ts, MAP_FILES) and kept here once fetched, so a second map
// opens without the network. Tiles are range requests and are not kept.
const MAP_CACHE = 'club:map';
const MAP_FILE = /^\/(?:assets\/maplibre-[\w-]+\.(?:js|css)|map\/v\d+\/.+)$/;
/** Glyphs and sprites never change in place: a new set is a new folder (v1, v2). */
const mapFolder = (path: string) => /^\/map\/(v\d+)\//.exec(path)?.[1];
/** A built file's name without its hash: a new build's copy replaces the old. */
const builtName = (path: string) => path.replace(/-[\w-]{8}(\.\w+)$/, '$1');

/** What a map file must be: never the site's index.html standing in for a file gone. */
export function isMapFile(path: string, contentType: string | null): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('text/html')) return false;
  if (path.endsWith('.js')) return type.includes('javascript');
  if (path.endsWith('.css')) return type.includes('text/css');
  if (path.endsWith('.json')) return type.includes('json');
  if (path.endsWith('.png')) return type.includes('image/png');
  return true;
}

export async function mapFile({ request, url }: { request: Request; url: URL }) {
  const cache = await caches.open(MAP_CACHE).catch(() => undefined);
  const kept = await cache?.match(request).catch(() => undefined);
  if (kept) return kept;
  const response = await fetch(request);
  // Only a real copy replaces the kept one, and only once it is in: storage
  // that is full never costs the page its answer, nor the old copy.
  if (
    cache &&
    response.status === 200 &&
    isMapFile(url.pathname, response.headers.get('content-type'))
  ) {
    try {
      await cache.put(request, response.clone());
      const name = builtName(url.pathname);
      const folder = mapFolder(url.pathname);
      for (const old of await cache.keys()) {
        const path = new URL(old.url).pathname;
        const replaced = builtName(path) === name;
        const otherFolder =
          folder !== undefined && mapFolder(path) !== undefined && mapFolder(path) !== folder;
        if (old.url !== request.url && (replaced || otherFolder)) await cache.delete(old);
      }
    } catch {
      // Kept as it was.
    }
  }
  return response;
}

registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin && request.method === 'GET' && MAP_FILE.test(url.pathname),
  mapFile,
);

// "Share to The SCI Club" (manifest share_target, Android). The share is a
// POST the app cannot read, so it is kept in a cache of its own, photographs
// and all, and the app is opened on /share, which reads it once. A 303, so
// the browser goes there with a GET and a refresh does not post again.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const text = (name: string) => {
          const value = form.get(name);
          return typeof value === 'string' ? value : '';
        };
        const photos = form
          .getAll('photos')
          .filter(
            (value): value is File => value instanceof File && value.type.startsWith('image/'),
          )
          .slice(0, SHARE_MAX_FILES);
        await caches.delete(SHARE_CACHE);
        const cache = await caches.open(SHARE_CACHE);
        await Promise.all(
          photos.map((photo, index) =>
            cache.put(
              shareFileKey(index),
              new Response(photo, {
                headers: {
                  'Content-Type': photo.type,
                  'x-file-name': encodeURIComponent(photo.name),
                },
              }),
            ),
          ),
        );
        await cache.put(
          SHARE_META,
          new Response(
            JSON.stringify({
              title: text('title'),
              text: text('text'),
              url: text('url'),
              files: photos.length,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
      } catch {
        // Whatever could not be read is simply not there on /share.
      }
      return Response.redirect('/share', 303);
    })(),
  );
});

self.addEventListener('push', (event) => {
  // Always a notification, whatever arrived — see the payload file's header.
  const { title, options, badge } = readPushPayload(event.data?.text(), self.location.origin);
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // The number on the app icon, without opening the app. Only where the
      // platform has it (a Home Screen app on iOS 16.4+, installed Chrome).
      badge === undefined || !('setAppBadge' in self.navigator)
        ? undefined
        : (badge > 0 ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge()).catch(
            () => undefined,
          ),
    ]),
  );
});

// Persist a click across worker suspension and activation, so a resumed app
// can collect it even when Safari could not focus or message its old window.
const NAVIGATION_CACHE = 'club:notification-navigation';
const NAVIGATION_KEY = new URL('/__notification-navigation', self.location.origin).href;
interface PendingNavigation {
  path: string;
  at: number;
}

async function rememberNavigation(waiting: PendingNavigation) {
  const cache = await caches.open(NAVIGATION_CACHE);
  await cache.put(NAVIGATION_KEY, new Response(JSON.stringify(waiting)));
}

async function readNavigation(): Promise<PendingNavigation | null> {
  const cache = await caches.open(NAVIGATION_CACHE);
  const saved = await cache.match(NAVIGATION_KEY);
  if (!saved) return null;
  const waiting = (await saved.json()) as PendingNavigation;
  if (typeof waiting.path !== 'string' || !Number.isFinite(waiting.at)) return null;
  return { path: safePath(waiting.path, self.location.origin), at: waiting.at };
}

async function forgetNavigation(waiting: PendingNavigation) {
  const saved = await readNavigation().catch(() => null);
  // A later click must survive the acknowledgement of an earlier one.
  if (saved?.path === waiting.path && saved.at === waiting.at) {
    await (await caches.open(NAVIGATION_CACHE)).delete(NAVIGATION_KEY);
  }
}

/** Asks a running app to open `path` itself; true if it said it did. */
function askToOpen(client: Client, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ok);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, 1500);
    channel.port1.onmessage = (event) => {
      const data: unknown = event.data;
      if (typeof data === 'object' && data !== null && 'ok' in data && data.ok === true)
        finish(true);
    };
    try {
      client.postMessage({ type: NAVIGATE, path }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const origin = self.location.origin;
  const data = event.notification.data as { url?: unknown } | null;
  const path = safePath(data?.url, origin);
  const waiting = { path, at: Date.now() };
  event.waitUntil(
    (async () => {
      await rememberNavigation(waiting).catch(() => undefined);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const index = pickWindow(windows, path, origin);
      const target = index === null ? undefined : windows[index];
      if (!target) {
        await self.clients.openWindow(path);
        return;
      }
      // A focus rejection must not abort delivery to an already-open app.
      await target.focus().catch(() => undefined);
      if (await askToOpen(target, path)) {
        await forgetNavigation(waiting);
        return;
      }
      // An app too old to answer, or one still starting. Keep the click for
      // the startup/resume handshake even when navigate() appears to work.
      if (safePath(target.url, origin) !== path) await target.navigate(path).catch(() => null);
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  const client = event.source;
  if (data?.type !== PENDING || !client || !('type' in client) || client.type !== 'window') return;
  event.waitUntil(
    (async () => {
      const waiting = await readNavigation().catch(() => null);
      if (!waiting) return;
      if (Date.now() - waiting.at < PENDING_FOR_MS && (await askToOpen(client, waiting.path))) {
        await forgetNavigation(waiting);
      } else if (Date.now() - waiting.at >= PENDING_FOR_MS) {
        await forgetNavigation(waiting);
      }
    })(),
  );
});
