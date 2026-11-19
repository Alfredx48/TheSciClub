import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { TextZoom } from '@capacitor/text-zoom';
import { androidAppleCallback, finishAndroidApple } from '@/lib/android-apple-sign-in';
import {
  APP_SCHEME,
  clubPath,
  HANDOFF_CODE,
  LINK_CODE_PARAM,
  takeAppHandoff,
} from '@/lib/app-handoff';
import { SITE_ORIGIN } from '@/lib/site-origin';

/**
 * The store app's native pieces: the splash, the status bar, Android's back
 * button, links to other sites, links that open the app and taps on its
 * notifications. Loaded only in the app (NativeShell), so
 * the website never downloads the plugins.
 */

export type LinkTarget = { inside: string } | { outside: string } | null;

const CLUB_ORIGINS = new Set([SITE_ORIGIN, 'https://www.thesciclub.com']);

/**
 * Where a tapped link goes. The club's own address stays in the app; any
 * other site opens in the in-app browser, never in place of the club. Null
 * leaves it to the page: the app's own links, mailto: and tel:.
 */
export function linkTarget(href: string, appOrigin: string, newTab = false): LinkTarget {
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return null;
  }
  // The app has no tabs, so a page of its own meant for a new tab (the Terms
  // from a step of joining) opens from the website, leaving the step as it was.
  // By scheme and host: a URL's origin is "null" for capacitor:, outside WebKit.
  if (`${url.protocol}//${url.host}` === appOrigin) {
    return newTab ? { outside: `${SITE_ORIGIN}${url.pathname}${url.search}${url.hash}` } : null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (CLUB_ORIGINS.has(url.origin)) return { inside: `${url.pathname}${url.search}${url.hash}` };
  return { outside: url.href };
}

/**
 * Where a link that opened the app goes (Universal Links: the paths in
 * public/.well-known/apple-app-site-association). The club's own address,
 * routed inside the app; anything else, such as Google sign-in's return to
 * its custom scheme, is not the app's to route.
 */
export function openedLinkPath(href: string, appOrigin: string): string | null {
  const target = linkTarget(href, appOrigin);
  return target && 'inside' in target ? target.inside : null;
}

/**
 * What a link that opened the app asks for: a page, and a code to sign in by
 * if it carries one (app-handoff.ts). The app's own thesciclub://open link
 * ("Open in the app"), or a club address: a Universal Link, or the address
 * Safari's banner hands over. A code that is not one is dropped, and taken
 * out of the address either way, so it never stays in the app's history.
 */
export function readOpenedLink(
  href: string,
  appOrigin: string,
): { path: string; code: string | null } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const codeFrom = (value: string | null) => (value && HANDOFF_CODE.test(value) ? value : null);
  if (url.protocol === `${APP_SCHEME}:`) {
    const path = clubPath(url.searchParams.get('path'));
    return path ? { path, code: codeFrom(url.searchParams.get('code')) } : null;
  }
  const inside = openedLinkPath(href, appOrigin);
  if (!inside) return null;
  const page = new URL(inside, SITE_ORIGIN);
  const code = codeFrom(page.searchParams.get(LINK_CODE_PARAM));
  page.searchParams.delete(LINK_CODE_PARAM);
  return { path: `${page.pathname}${page.search}${page.hash}`, code };
}

/**
 * Where a tapped notification goes: its `url` (push-notify's apns.ts), routed
 * as a link that opened the app would be. Anything not the club's is ignored.
 */
export function notificationPath(data: unknown, appOrigin: string): string | null {
  const url = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : null;
  if (typeof url !== 'string' || url === '') return null;
  let href: string;
  try {
    href = new URL(url, SITE_ORIGIN).href;
  } catch {
    return null;
  }
  return openedLinkPath(href, appOrigin);
}

/** Android's back: closes an open sheet first, then goes back, then leaves. */
export function backStep(sheetOpen: boolean, canGoBack: boolean): 'close' | 'back' | 'leave' {
  if (sheetOpen) return 'close';
  return canGoBack ? 'back' : 'leave';
}

/** Light words on a dark page, dark on a light one, as accessibility.tsx paints it. */
export function barStyle(root: DOMStringMap, systemDark: boolean): SystemBarsStyle {
  if (root.forceLight !== undefined) return SystemBarsStyle.Light;
  const dark = root.appearance === 'dark' || (root.appearance !== 'light' && systemDark);
  return dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
}

/**
 * The phone's Text Size as a multiplier on the club's own (index.css), never
 * below 1: a smaller setting leaves the club's sizes as they are.
 */
export function systemTextScale(preferred: number): number {
  if (!Number.isFinite(preferred) || preferred <= 1) return 1;
  return Math.round(preferred * 100) / 100;
}

/**
 * WKWebView ignores the iPhone's Text Size, so it is read and applied here.
 * Android's web view already follows the system's font size by itself.
 */
async function followTextSize(): Promise<void> {
  if (Capacitor.getPlatform() !== 'ios') return;
  const { value } = await TextZoom.getPreferred();
  document.documentElement.style.setProperty('--system-text-scale', String(systemTextScale(value)));
}

function quietly(work: Promise<unknown>): void {
  work.catch(() => undefined);
}

export function startNativeShell(navigate: (to: string | number) => void): () => void {
  const listeners: Promise<PluginListenerHandle>[] = [];
  const platform = Capacitor.getPlatform();
  // index.css moves every screen below the status bar.
  document.documentElement.dataset.nativeApp = '';

  // Room for the keyboard, from its own height: index.css takes it off every
  // full-height screen and adds it below the rest (2026-11-07).
  const root = document.documentElement;
  const keyboardOpen = (height: number) => {
    // Android's WebView already resizes for the keyboard.
    if (platform !== 'android') {
      root.style.setProperty('--keyboard-height', `${String(Math.max(0, Math.round(height)))}px`);
    }
    root.dataset.keyboard = '';
  };
  const keyboardClosed = () => {
    root.style.removeProperty('--keyboard-height');
    delete root.dataset.keyboard;
  };
  listeners.push(
    Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
      keyboardOpen(keyboardHeight);
    }),
    // Its height can change while it is up: the suggestions bar, another language.
    Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
      keyboardOpen(keyboardHeight);
    }),
    Keyboard.addListener('keyboardWillHide', keyboardClosed),
  );

  listeners.push(
    App.addListener('backButton', ({ canGoBack }) => {
      // Not one left open in a kept tab, hidden (App.tsx): its Escape is not listening.
      const sheet = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(
        (dialog) => !dialog.closest('[style*="display: none"]'),
      );
      const step = backStep(sheet, canGoBack);
      // Every sheet closes on Escape (useDialogFocus).
      if (step === 'close') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (step === 'back') navigate(-1);
      else quietly(App.minimizeApp());
    }),
  );

  // A link that opened the app, cold or warm: an invite, an emailed link, a
  // shared page, or a browser's "Open in the app" carrying its sign-in
  // (app-handoff.ts). Kept by the plugin until this listener takes it.
  listeners.push(
    App.addListener('appUrlOpen', ({ url }) => {
      if (platform === 'android' && import.meta.env.VITE_ANDROID_APPLE_SIGN_IN === 'true') {
        const callback = androidAppleCallback(url);
        if (callback) {
          quietly(
            finishAndroidApple(callback).then((path) => {
              if (path) window.location.replace(path);
            }),
          );
          return;
        }
      }
      const opened = readOpenedLink(url, window.location.origin);
      if (!opened) return;
      if (!opened.code) {
        navigate(opened.path);
        return;
      }
      void takeAppHandoff(opened.code)
        .catch(() => 'refused')
        .then(() => {
          navigate(opened.path);
        });
    }),
  );

  // A tapped notification, cold or warm; kept by the plugin until this
  // listener takes it.
  if (
    platform === 'ios' ||
    (platform === 'android' && import.meta.env.VITE_ANDROID_PUSH === 'true')
  ) {
    listeners.push(
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const path = notificationPath(notification.data, window.location.origin);
        if (path) navigate(path);
      }),
    );
  }

  function onClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const target = linkTarget(anchor.href, window.location.origin, anchor.target === '_blank');
    if (!target) return;
    event.preventDefault();
    if ('inside' in target) navigate(target.inside);
    else quietly(Browser.open({ url: target.outside }));
  }
  // Capture, so it is decided before any handler on the link itself.
  document.addEventListener('click', onClick, true);

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  function paintBar() {
    quietly(
      SystemBars.setStyle({ style: barStyle(document.documentElement.dataset, scheme.matches) }),
    );
  }
  const watch = new MutationObserver(paintBar);
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-appearance', 'data-force-light'],
  });
  scheme.addEventListener('change', paintBar);
  paintBar();

  // Text Size is changed in Settings, so coming back is when to look again.
  listeners.push(
    App.addListener('resume', () => {
      quietly(followTextSize());
    }),
  );

  // The first screen is drawn: the splash goes once its text is the right size.
  quietly(
    followTextSize()
      .catch(() => undefined)
      .then(() => SplashScreen.hide({ fadeOutDuration: 200 })),
  );

  return () => {
    delete document.documentElement.dataset.nativeApp;
    keyboardClosed();
    document.removeEventListener('click', onClick, true);
    watch.disconnect();
    scheme.removeEventListener('change', paintBar);
    for (const listener of listeners) quietly(listener.then((handle) => handle.remove()));
  };
}
