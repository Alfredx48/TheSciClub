import { Capacitor } from '@capacitor/core';

/**
 * The store app (Capacitor), on an iPhone or Android, rather than a browser
 * tab or the Home Screen app. Whatever only makes sense in a browser asks this
 * first and stays out of the app: installing, web push, the service worker,
 * the Home Screen sign-in hand-off. The website never sees true.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isAndroidApp(): boolean {
  return isNative() && Capacitor.getPlatform() === 'android';
}

/**
 * Whether this is the club opened from the Home Screen, not a browser tab.
 *
 * On an iPhone or iPad, Safari's own `navigator.standalone` is the answer and
 * the only one trusted (the owner, 2026-10-11: a friend's iPhone, signed in
 * in Safari, never saw the install nudge). WebKit's `display-mode` media query
 * has been wrong in both directions there: true for a page a Home Screen app
 * opened in Safari (WebKit 250651), `fullscreen` for the app itself (WebKit
 * 264218). Elsewhere the media query is the standard and is used.
 */
export function isStandalone(): boolean {
  const safari = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (typeof safari === 'boolean') return safari;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}
