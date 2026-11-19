import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { isAndroidApp } from '@/lib/standalone';

/**
 * Native push permission, APNs or FCM tokens, and the app icon's count.
 *
 * The token goes to the club as `apns:<environment>:<token>`
 * (20261023030000). TestFlight and App Store builds get production tokens; a
 * development build from Xcode gets sandbox ones and must be built with
 * VITE_APNS_ENVIRONMENT=sandbox.
 */

export type AppPermission = 'granted' | 'denied' | 'default';

const AndroidNotifications = registerPlugin<{
  areEnabled(): Promise<{ enabled: boolean }>;
  openSettings(): Promise<void>;
}>('AndroidNotifications');

/** The plugin's answer in the web's words: `prompt` is not asked yet. */
export function toPermission(receive: string): AppPermission {
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'default';
}

export function apnsEnvironment(): 'production' | 'sandbox' {
  return import.meta.env.VITE_APNS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
}

/** The endpoint the club keeps for this iPhone. */
export function appEndpoint(token: string): string {
  return `apns:${apnsEnvironment()}:${token.toLowerCase()}`;
}

const INSTALLATION_KEY = 'club:android-push-installation';

export function androidPushInstallation(create = false): string | null {
  const saved = localStorage.getItem(INSTALLATION_KEY);
  if (saved || !create) return saved;
  const installation = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, installation);
  return installation;
}

export async function appPermission(): Promise<AppPermission> {
  const permission = toPermission((await PushNotifications.checkPermissions()).receive);
  if (
    permission === 'granted' &&
    isAndroidApp() &&
    !(await AndroidNotifications.areEnabled()).enabled
  )
    return 'denied';
  return permission;
}

/** The system's prompt; iOS shows it once, and after that answers by itself. */
export async function askAppPermission(): Promise<AppPermission> {
  const permission = toPermission((await PushNotifications.requestPermissions()).receive);
  return permission === 'granted' && isAndroidApp() ? appPermission() : permission;
}

export function openAndroidNotificationSettings(): Promise<void> {
  return AndroidNotifications.openSettings();
}

const TOKEN_WAIT_MS = 15_000;
let token: Promise<string> | null = null;

/**
 * This iPhone's token, asked of iOS once per launch. iOS answers through an
 * event, so the listeners go on before `register()`. A failure is not kept:
 * the next call asks again.
 */
export function appToken(): Promise<string> {
  token ??= new Promise<string>((resolve, reject) => {
    const handles: Promise<PluginListenerHandle>[] = [];
    const finish = (error: Error | null, value?: string) => {
      clearTimeout(timer);
      for (const handle of handles) void handle.then((h) => h.remove()).catch(() => undefined);
      if (error || !value) reject(error ?? new Error('No device token'));
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error('The notification service did not answer with a device token'));
    }, TOKEN_WAIT_MS);
    handles.push(
      PushNotifications.addListener('registration', ({ value }) => {
        finish(null, value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        finish(new Error(error));
      }),
    );
    Promise.all(handles)
      .then(async () => {
        if (!isAndroidApp()) return;
        await PushNotifications.createChannel({
          id: 'club-notifications',
          name: 'The SCI Club',
          importance: 4,
          visibility: 0,
        }).catch((error: unknown) => {
          // Android 7 delivers notifications without channels.
          if ((error as { code?: unknown } | null)?.code !== 'UNAVAILABLE') throw error;
        });
      })
      .then(() => PushNotifications.register())
      .catch((e: unknown) => {
        finish(e instanceof Error ? e : new Error(String(e)));
      });
  })
    .then((value) => {
      if (isAndroidApp()) token = null;
      return value;
    })
    .catch((e: unknown) => {
      token = null;
      throw e;
    });
  return token;
}

export async function clearAndroidNotifications(): Promise<void> {
  await PushNotifications.removeAllDeliveredNotifications();
}

let badge: Promise<void> = Promise.resolve();

/**
 * The number on the app's icon (icon-badge.ts); 0 clears it. One at a time, so the last
 * count wins. Only once notifications are allowed: the badge plugin's `set`
 * asks iOS itself, and the club never asks on its own.
 */
export function setIconBadge(count: number): Promise<void> {
  const next = badge.then(async () => {
    if ((await appPermission()) !== 'granted') return;
    await Badge.set({ count });
  });
  badge = next.catch(() => undefined);
  return next;
}
