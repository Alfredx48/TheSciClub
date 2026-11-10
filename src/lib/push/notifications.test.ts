import { Capacitor } from '@capacitor/core';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appOpeningFacts,
  askOnOpening,
  base64UrlToBytes,
  type DeviceFacts,
  forgetThisDevice,
  markNotificationsAsked,
  notificationState,
  notificationsAskedRecently,
  type OpeningFacts,
  openingFacts,
  readDeviceState,
  restoreDeviceNotifications,
  showOnAppIcon,
  turnOffNotifications,
  turnOnNotifications,
  useDeviceNotifications,
} from '@/lib/push/notifications';

/**
 * The pure half is a table. The browser half is driven through stubbed
 * globals — jsdom has no PushManager and no Notification, and the network
 * guard in setup.ts would refuse the real rpc anyway — to pin the two orders
 * that matter: permission before anything is awaited, and the row deleted
 * before the browser forgets the subscription.
 */

const calls = vi.hoisted(() => ({
  log: [] as string[],
  rpcError: null as { code: string; message: string } | null,
  deleteError: null as { message: string } | null,
  readError: null as { message: string } | null,
  memberId: 'me',
  onFile: true,
  subscriptionPresent: false,
  beforeRpc: null as (() => Promise<void>) | null,
}));

/** iOS, as the push plugin reports it in the store app. */
interface Ios {
  permission: string;
  /** What the system prompt answers. */
  answer: string;
  token: string | null;
  listeners: Record<string, (event: Record<string, string>) => void>;
  /** Every number put on the icon, in order. */
  badges: number[];
  /** How long the next permission check takes, in ms. */
  slowCheck: number;
}
const ios = vi.hoisted(
  (): Ios => ({
    permission: 'prompt',
    answer: 'granted',
    token: null,
    listeners: {},
    badges: [],
    slowCheck: 0,
  }),
);

vi.mock('@capawesome/capacitor-badge', () => ({
  Badge: {
    set: ({ count }: { count: number }) => {
      ios.badges.push(count);
      return Promise.resolve();
    },
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => {
      const wait = ios.slowCheck;
      ios.slowCheck = 0;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      return { receive: ios.permission };
    },
    requestPermissions: () => {
      calls.log.push('ios prompt');
      ios.permission = ios.answer;
      return Promise.resolve({ receive: ios.answer });
    },
    addListener: (name: string, listener: (event: Record<string, string>) => void) => {
      ios.listeners[name] = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    register: () => {
      calls.log.push('ios register');
      if (ios.token) ios.listeners.registration?.({ value: ios.token });
      else ios.listeners.registrationError?.({ error: 'no network' });
      return Promise.resolve();
    },
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: calls.memberId ? { user: { id: calls.memberId } } : null },
          error: null,
        }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      const device =
        name === 'push_subscribe_app'
          ? `${String(args.app_token)} ${String(args.app_environment)}`
          : String(args.sub_endpoint);
      calls.log.push(`rpc ${name} ${device}`);
      await calls.beforeRpc?.();
      if (!calls.rpcError) calls.onFile = true;
      return { error: calls.rpcError };
    },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        delete: () => query,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              calls.onFile && filters.member_id === calls.memberId
                ? { endpoint: filters.endpoint }
                : null,
            error: calls.readError,
          }),
        then: <T, U>(
          resolve: (value: { error: typeof calls.deleteError }) => T | PromiseLike<T>,
          reject?: (reason: unknown) => U | PromiseLike<U>,
        ) => {
          calls.log.push(
            `delete ${table} endpoint=${filters.endpoint} member_id=${filters.member_id}`,
          );
          if (!calls.deleteError) calls.onFile = false;
          return Promise.resolve({ error: calls.deleteError }).then(resolve, reject);
        },
      };
      return query;
    },
  }),
}));

const facts = (over: Partial<DeviceFacts>): DeviceFacts => ({
  canPush: true,
  standalone: true,
  permission: 'default',
  subscribed: false,
  ...over,
});

describe('notificationState', () => {
  it.each<[string, Partial<DeviceFacts>, string]>([
    ['an iPhone in a Safari tab', { canPush: false, standalone: false }, 'install'],
    [
      'an iPhone on the Home Screen before 16.4',
      { canPush: false, standalone: true },
      'unsupported',
    ],
    ['a device never asked', { permission: 'default' }, 'off'],
    [
      'a device that said yes and has a subscription on file',
      { permission: 'granted', subscribed: true },
      'on',
    ],
    // Permission is per origin and outlives the row: signing out deletes the
    // row and the next member on the phone has not turned anything on.
    ['a device that said yes whose subscription is not on file', { permission: 'granted' }, 'off'],
    ['a device that said no', { permission: 'denied' }, 'refused'],
    // "No" wins over a row the club still has, or the row would offer a
    // button the system will ignore.
    [
      'a device that said no after saying yes',
      { permission: 'denied', subscribed: true },
      'refused',
    ],
    ['a desktop browser tab', { standalone: false, permission: 'default' }, 'off'],
  ])('%s is %s', (_, over, expected) => {
    expect(notificationState(facts(over))).toBe(expected);
  });
});

const opening = (over: Partial<OpeningFacts>): OpeningFacts => ({
  enabled: true,
  standalone: true,
  permission: 'default',
  askedRecently: false,
  ...over,
});

describe('askOnOpening', () => {
  it.each<[string, Partial<OpeningFacts>, boolean]>([
    ['the installed app, never asked on this phone', {}, true],
    // Signing up in Safari said how to install; nothing could be asked there.
    ['a Safari tab', { standalone: false }, false],
    ['while the club cannot send', { enabled: false }, false],
    ['a phone that said yes', { permission: 'granted' }, false],
    // The system will not show its prompt again, so the button would do nothing.
    ['a phone that said no', { permission: 'denied' }, false],
    [
      'an installed app with no notifications at all (iOS before 16.4)',
      { permission: null },
      false,
    ],
    ['a phone that answered Not now in the last five days', { askedRecently: true }, false],
  ])('%s: %s', (_, over, expected) => {
    expect(askOnOpening(opening(over))).toBe(expected);
  });
});

describe('remembering that this phone was asked', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has not been asked, until it is', () => {
    expect(notificationsAskedRecently()).toBe(false);
    markNotificationsAsked();
    expect(notificationsAskedRecently()).toBe(true);
  });

  // The owner, 2026-10-21: Not now holds five days, then the next opening asks.
  it('asks again five days after Not now', () => {
    const day = 86_400_000;
    localStorage.setItem('thesciclub.notificationsAsked', '2026-10-01T09:00:00.000Z');
    const asked = Date.parse('2026-10-01T09:00:00.000Z');
    expect(notificationsAskedRecently(asked + 4 * day)).toBe(true);
    expect(notificationsAskedRecently(asked + 5 * day - 1)).toBe(true);
    expect(notificationsAskedRecently(asked + 5 * day)).toBe(false);
  });

  it('counts as asked when it cannot remember, rather than asking every time', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(notificationsAskedRecently()).toBe(true);
  });

  it('does not throw when it cannot write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      markNotificationsAsked();
    }).not.toThrow();
  });
});

describe('base64UrlToBytes', () => {
  it('reads base64url, unpadded, into bytes', () => {
    // "hi?" is 0x68 0x69 0x3f, which is "aGk_" in base64url and "aGk/" in base64.
    expect([...base64UrlToBytes('aGk_')]).toEqual([0x68, 0x69, 0x3f]);
    expect([...base64UrlToBytes('aGk')]).toEqual([0x68, 0x69]);
  });
});

describe('turning on and off', () => {
  const endpoint = 'https://web.push.apple.com/device-1';
  const subscription = {
    endpoint,
    options: {
      applicationServerKey: base64UrlToBytes('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ').buffer,
    },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }),
    unsubscribe: () => {
      calls.log.push('unsubscribe');
      calls.subscriptionPresent = false;
      return Promise.resolve(true);
    },
  };
  let permission: NotificationPermission;

  beforeEach(() => {
    calls.log = [];
    calls.rpcError = null;
    calls.deleteError = null;
    calls.readError = null;
    calls.memberId = 'me';
    calls.onFile = true;
    calls.subscriptionPresent = false;
    calls.beforeRpc = null;
    localStorage.clear();
    permission = 'granted';
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ');
    vi.stubGlobal('PushManager', {});
    vi.stubGlobal('Notification', {
      get permission() {
        return permission;
      },
      requestPermission: () => {
        calls.log.push('requestPermission');
        return Promise.resolve(permission);
      },
    });
    const registration = {
      pushManager: {
        getSubscription: () => {
          calls.log.push('getSubscription');
          return Promise.resolve(calls.subscriptionPresent ? subscription : null);
        },
        subscribe: () => {
          calls.log.push('subscribe');
          calls.subscriptionPresent = true;
          return Promise.resolve(subscription);
        },
      },
    };
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      serviceWorker: {
        get ready() {
          calls.log.push('ready');
          return Promise.resolve(registration);
        },
        getRegistration: () =>
          Promise.resolve({
            pushManager: {
              getSubscription: () =>
                Promise.resolve(calls.subscriptionPresent ? subscription : null),
            },
          }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('in the Android app, which has no sender yet', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    });

    it('never asks on opening, whatever the permission says', () => {
      permission = 'default';
      expect(openingFacts().permission).toBeNull();
      expect(askOnOpening(openingFacts())).toBe(false);
    });

    it('draws no row on Me: the state is never read', async () => {
      const { result } = renderHook(() => useDeviceNotifications('me'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.state).toBeNull();
      expect(calls.log).toEqual([]);
    });

    it('neither asks for permission nor subscribes', async () => {
      expect((await turnOnNotifications('me')).ok).toBe(false);
      expect(await restoreDeviceNotifications('me')).toBe('off');
      await forgetThisDevice();
      expect(calls.log).toEqual([]);
    });

    it('puts no number on the icon', async () => {
      ios.badges = [];
      ios.permission = 'granted';
      await showOnAppIcon(3);
      await forgetThisDevice();
      expect(ios.badges).toEqual([]);
    });
  });

  describe('in the iPhone app, through Apple', () => {
    const token = 'AB'.repeat(32);
    const device = `apns:production:${'ab'.repeat(32)}`;

    beforeEach(() => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
      ios.permission = 'prompt';
      ios.answer = 'granted';
      ios.token = token;
      calls.onFile = false;
    });

    it('is off until asked, and asks iOS for nothing yet', async () => {
      expect(await readDeviceState('me')).toBe('off');
      expect(calls.log).toEqual([]);
    });

    it('asks iOS, then hands the club the token', async () => {
      expect(await turnOnNotifications('me')).toEqual({ ok: true, state: 'on' });
      expect(calls.log).toEqual([
        'ios prompt',
        'ios register',
        `rpc push_subscribe_app ${token} production`,
      ]);
      expect(await readDeviceState('me')).toBe('on');
    });

    it('says refused at a no, and hands over nothing', async () => {
      ios.answer = 'denied';
      expect(await turnOnNotifications('me')).toEqual({ ok: true, state: 'refused' });
      expect(await readDeviceState('me')).toBe('refused');
      expect(calls.log).toEqual(['ios prompt']);
    });

    it('says so when Apple gives no token', async () => {
      ios.token = null;
      // A fresh launch: the token is asked of iOS once per launch.
      vi.resetModules();
      const fresh = await import('@/lib/push/notifications');
      const outcome = await fresh.turnOnNotifications('me');
      expect(outcome.ok).toBe(false);
      expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
    });

    it('turns off by deleting this iPhone’s row', async () => {
      await turnOnNotifications('me');
      calls.log = [];
      expect(await turnOffNotifications('me')).toEqual({ ok: true, state: 'off' });
      expect(calls.log).toEqual([`delete push_subscriptions endpoint=${device} member_id=me`]);
    });

    it('pauses at logout and hands the token over again after login, without asking', async () => {
      await turnOnNotifications('me');
      await forgetThisDevice();
      expect(calls.onFile).toBe(false);
      calls.log = [];
      expect(await restoreDeviceNotifications('me')).toBe('on');
      expect(calls.log).toEqual([`rpc push_subscribe_app ${token} production`]);
    });

    it('forgets this iPhone at logout even once iOS was switched off in Settings', async () => {
      await turnOnNotifications('me');
      ios.permission = 'denied';
      calls.log = [];
      await forgetThisDevice();
      expect(calls.log).toEqual([`delete push_subscriptions endpoint=${device} member_id=me`]);
      expect(calls.onFile).toBe(false);
    });

    it('never opts in another account on this iPhone', async () => {
      await turnOnNotifications('me');
      await forgetThisDevice();
      calls.memberId = 'somebody-else';
      calls.log = [];
      expect(await restoreDeviceNotifications('somebody-else')).toBe('off');
      expect(calls.log).toEqual([]);
    });

    it('puts the unread count on the icon, and 0 clears it', async () => {
      ios.permission = 'granted';
      ios.badges = [];
      await showOnAppIcon(3);
      await showOnAppIcon(0);
      expect(ios.badges).toEqual([3, 0]);
    });

    // The badge plugin's `set` asks iOS for permission itself.
    it('leaves the icon alone until notifications are allowed, and never asks', async () => {
      ios.badges = [];
      await showOnAppIcon(3);
      ios.permission = 'denied';
      await showOnAppIcon(3);
      expect(ios.badges).toEqual([]);
      expect(calls.log).toEqual([]);
    });

    it('sets the icon in order, so the last count wins', async () => {
      ios.permission = 'granted';
      ios.badges = [];
      ios.slowCheck = 20;
      await Promise.all([showOnAppIcon(2), showOnAppIcon(0)]);
      expect(ios.badges).toEqual([2, 0]);
    });

    it('clears the icon at logout', async () => {
      await turnOnNotifications('me');
      ios.badges = [];
      await forgetThisDevice();
      expect(ios.badges).toEqual([0]);
    });

    it('draws the row on Me', async () => {
      const { result } = renderHook(() => useDeviceNotifications('me'));
      await vi.waitFor(() => {
        expect(result.current.state).toBe('off');
      });
    });

    it('asks on the app’s first launch on a phone, and not again within 5 days of "Not now"', async () => {
      const facts = await appOpeningFacts();
      expect(facts).toEqual({
        enabled: true,
        standalone: true,
        permission: 'default',
        askedRecently: false,
      });
      expect(askOnOpening(facts)).toBe(true);
      markNotificationsAsked();
      expect(askOnOpening(await appOpeningFacts())).toBe(false);
    });
  });

  it('on the website, puts the count on the icon and clears it at logout', async () => {
    ios.badges = [];
    const icon: string[] = [];
    vi.stubGlobal('navigator', {
      userAgent: 'test',
      setAppBadge: (count: number) => {
        icon.push(`set ${count}`);
        return Promise.resolve();
      },
      clearAppBadge: () => {
        icon.push('clear');
        return Promise.resolve();
      },
    });
    await showOnAppIcon(4);
    await showOnAppIcon(0);
    await forgetThisDevice();
    expect(icon).toEqual(['set 4', 'clear', 'clear']);
    expect(ios.badges).toEqual([]);
  });

  it('on the website, the same phone would be asked', () => {
    permission = 'default';
    vi.stubGlobal('navigator', { userAgent: 'test', standalone: true, serviceWorker: {} });
    expect(askOnOpening(openingFacts())).toBe(true);
  });

  // iOS ignores a permission request that is not the direct result of a tap.
  // The call must happen before the first await, so it is first in the log
  // *synchronously* — before the returned promise has had a chance to run on.
  it('asks for permission before it awaits anything', async () => {
    const pending = turnOnNotifications('me');
    expect(calls.log).toEqual(['requestPermission']);
    await pending;
  });

  it('subscribes and hands the club the endpoint', async () => {
    expect(await turnOnNotifications('me')).toEqual({ ok: true, state: 'on' });
    expect(calls.log).toEqual([
      'requestPermission',
      'ready',
      'getSubscription',
      'subscribe',
      `rpc push_subscribe ${endpoint}`,
    ]);
  });

  it('stops at a no, and says it is refused rather than failing', async () => {
    permission = 'denied';
    expect(await turnOnNotifications('me')).toEqual({ ok: true, state: 'refused' });
    expect(calls.log).toEqual(['requestPermission']);
  });

  it('says what the club said when it refuses the subscription', async () => {
    calls.rpcError = {
      code: 'P0001',
      message: 'Notifications cannot be turned on while your membership is paused.',
    };
    expect(await turnOnNotifications('me')).toEqual({
      ok: false,
      error: 'Notifications cannot be turned on while your membership is paused.',
    });
  });

  it('does nothing while the club cannot send', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    expect((await turnOnNotifications('me')).ok).toBe(false);
    expect(calls.log).toEqual([]);
  });

  // While the row exists the sender can reach this phone. If the browser
  // forgot first and the delete then failed, the member would read "off" and
  // keep being notified.
  it('deletes the row before the browser forgets the subscription', async () => {
    calls.subscriptionPresent = true;
    expect(await turnOffNotifications('me')).toEqual({ ok: true, state: 'off' });
    expect(calls.log).toEqual([
      `delete push_subscriptions endpoint=${endpoint} member_id=me`,
      'unsubscribe',
    ]);
  });

  it('pauses an existing subscription at logout and restores it after login without a prompt', async () => {
    calls.subscriptionPresent = true;
    expect(await readDeviceState('me')).toBe('on');
    await forgetThisDevice();
    expect(calls.onFile).toBe(false);
    expect(calls.subscriptionPresent).toBe(true);
    expect(localStorage.getItem('thesciclub.deviceNotifications.me')).toBe('on');
    // Login reuses the preference in localStorage and the browser subscription.
    calls.memberId = 'me';
    expect(await restoreDeviceNotifications('me')).toBe('on');
    expect(calls.onFile).toBe(true);
    expect(calls.log).toEqual([
      `delete push_subscriptions endpoint=${endpoint} member_id=me`,
      'ready',
      `rpc push_subscribe ${endpoint}`,
    ]);
  });

  it('keeps an explicit off through logout and login even if unsubscribe leaves the browser subscription', async () => {
    calls.subscriptionPresent = true;
    expect(await turnOffNotifications('me')).toEqual({ ok: true, state: 'off' });
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    expect(await restoreDeviceNotifications('me')).toBe('off');
    expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
    expect(localStorage.getItem('thesciclub.deviceNotifications.me')).toBe('off');
  });

  it('never opts in another account just because this phone has permission', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    calls.memberId = 'somebody-else';
    expect(await restoreDeviceNotifications('somebody-else')).toBe('off');
    expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
    calls.memberId = 'me';
    expect(await restoreDeviceNotifications('me')).toBe('on');
  });

  it('does not ask or subscribe if the system permission or subscription was lost', async () => {
    await turnOnNotifications('me');
    await forgetThisDevice();
    calls.log = [];
    permission = 'denied';
    expect(await restoreDeviceNotifications('me')).toBe('refused');
    permission = 'default';
    expect(await restoreDeviceNotifications('me')).toBe('off');
    permission = 'granted';
    calls.subscriptionPresent = false;
    expect(await restoreDeviceNotifications('me')).toBe('off');
    expect(calls.log).toEqual(['ready']);
  });

  it('keeps the opt-in when restoration fails so a later opening can retry', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    calls.rpcError = { code: 'P0001', message: 'Try again later.' };
    await expect(restoreDeviceNotifications('me')).rejects.toThrow('Try again later.');
    expect(localStorage.getItem('thesciclub.deviceNotifications.me')).toBe('on');
    calls.rpcError = null;
    expect(await restoreDeviceNotifications('me')).toBe('on');
  });

  it('reports a failed status read rather than treating it as off', async () => {
    calls.subscriptionPresent = true;
    calls.readError = { message: 'Offline' };
    await expect(readDeviceState('me')).rejects.toEqual({ message: 'Offline' });
  });

  it('does not turn notifications off in memory when deletion fails', async () => {
    calls.subscriptionPresent = true;
    await readDeviceState('me');
    calls.deleteError = { message: 'Offline' };
    expect((await turnOffNotifications('me')).ok).toBe(false);
    expect(calls.subscriptionPresent).toBe(true);
    expect(localStorage.getItem('thesciclub.deviceNotifications.me')).toBe('on');
  });

  it('waits for a pending restoration write before logout detaches the endpoint', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    let finish: (() => void) | undefined;
    calls.beforeRpc = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    calls.log = [];
    const restoring = restoreDeviceNotifications('me');
    // Wait until the RPC is in flight before signing out.
    await vi.waitFor(() => {
      expect(finish).toBeDefined();
    });
    const leaving = forgetThisDevice();
    finish?.();
    await restoring;
    await leaving;
    expect(calls.log).toEqual([
      'ready',
      `rpc push_subscribe ${endpoint}`,
      `delete push_subscriptions endpoint=${endpoint} member_id=me`,
    ]);
    expect(calls.onFile).toBe(false);
  });

  it('does not reattach under an account that changed while restoration was waiting', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    calls.memberId = 'somebody-else';
    await expect(restoreDeviceNotifications('me')).rejects.toThrow();
    expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
  });

  it('leaves an unknown account off when local storage cannot be read', async () => {
    calls.subscriptionPresent = true;
    calls.onFile = false;
    const stored = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(await restoreDeviceNotifications('me')).toBe('off');
      expect(calls.log).toEqual([]);
    } finally {
      stored.mockRestore();
    }
  });

  it('does not restore a subscription created with an old sending key', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'aGk_');
    expect(await restoreDeviceNotifications('me')).toBe('off');
    expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
  });

  it('cancels restoration queued just before logout', async () => {
    calls.subscriptionPresent = true;
    await forgetThisDevice();
    calls.log = [];
    const restoring = restoreDeviceNotifications('me');
    const leaving = forgetThisDevice();
    expect(await restoring).toBe('off');
    await leaving;
    expect(calls.log.some((entry) => entry.startsWith('rpc'))).toBe(false);
  });
});
