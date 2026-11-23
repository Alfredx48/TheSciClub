import { isNative, isStandalone } from '@/lib/standalone';

/**
 * Which kind of device and which version of the app this is, for the admin site's crashes and
 * pushes (the owner, 2026-11-22: a push to the Home Screen app failed while the App Store app's
 * arrived, and nothing said which was which). Never which device or whose.
 *
 * `iphone-store-app` is the App Store app, `iphone-app` the Home Screen one, `iphone` Safari;
 * likewise ipad, android and computer.
 */
export function deviceOf(userAgent: string, standalone: boolean, native = false): string {
  const kind = userAgent.includes('iPad')
    ? 'ipad'
    : /iPhone|iPod/.test(userAgent)
      ? 'iphone'
      : userAgent.includes('Android')
        ? 'android'
        : 'computer';
  if (native) return `${kind}-store-app`;
  return standalone ? `${kind}-app` : kind;
}

export function thisDevice(): string {
  return deviceOf(navigator.userAgent, isStandalone(), isNative());
}

/** The web release this page was built as. */
export const RELEASE: string | null = import.meta.env.VITE_APP_BUILT ?? null;

let version: Promise<string | null> | null = null;

/** The store app's own version, as "1.4 (52)"; null on the website. */
export function appVersion(): Promise<string | null> {
  version ??= isNative()
    ? import('@capacitor/app')
        .then(({ App }) => App.getInfo())
        .then((info) => `${info.version} (${info.build})`)
        .catch(() => null)
    : Promise.resolve(null);
  return version;
}
