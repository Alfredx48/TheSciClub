import type * as CapacitorCore from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  back: null as ((event: { canGoBack: boolean }) => void) | null,
  resume: null as (() => void) | null,
  opened: null as ((event: { url: string }) => void) | null,
  tapped: null as ((event: { notification: { data: unknown } }) => void) | null,
  calls: [] as string[],
  /** What the phone's Text Size reads as. */
  textSize: 1,
  keyboard: new Map<string, (event: { keyboardHeight: number }) => void>(),
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: (name: string, listener: (event: { keyboardHeight: number }) => void) => {
      native.keyboard.set(name, listener);
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (name: string, listener: (event: { canGoBack: boolean }) => void) => {
      if (name === 'backButton') native.back = listener;
      if (name === 'resume') native.resume = listener as () => void;
      if (name === 'appUrlOpen') native.opened = listener as unknown as typeof native.opened;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    minimizeApp: () => {
      native.calls.push('minimize');
      return Promise.resolve();
    },
  },
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: (name: string, listener: NonNullable<typeof native.tapped>) => {
      if (name === 'pushNotificationActionPerformed') native.tapped = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: ({ url }: { url: string }) => {
      native.calls.push(`browser ${url}`);
      return Promise.resolve();
    },
  },
}));
vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: () => {
      native.calls.push('splash hidden');
      return Promise.resolve();
    },
  },
}));
vi.mock('@capacitor/text-zoom', () => ({
  TextZoom: {
    getPreferred: () => {
      native.calls.push('text size read');
      return Promise.resolve({ value: native.textSize });
    },
  },
}));
vi.mock('@capacitor/core', async (importOriginal) => {
  const core = await importOriginal<typeof CapacitorCore>();
  return {
    ...core,
    SystemBars: {
      setStyle: ({ style }: { style: string }) => {
        native.calls.push(`bar ${style}`);
        return Promise.resolve();
      },
    },
  };
});

/** A tap on a notification whose payload carries `url`. */
function tapNotification(url: string) {
  native.tapped?.({ notification: { data: { url } } });
}

const {
  backStep,
  barStyle,
  linkTarget,
  notificationPath,
  openedLinkPath,
  readOpenedLink,
  startNativeShell,
  systemTextScale,
} = await import('@/lib/native-shell');
const { Capacitor } = await import('@capacitor/core');

describe('where a link goes in the store app', () => {
  const app = 'capacitor://localhost';

  it('leaves the app’s own links, mail and phone numbers to the page', () => {
    expect(linkTarget('capacitor://localhost/chat', app)).toBeNull();
    expect(linkTarget('/events/1', app)).toBeNull();
    expect(linkTarget('mailto:hello@thesciclub.com', app)).toBeNull();
    expect(linkTarget('tel:+15555550100', app)).toBeNull();
    expect(linkTarget('https://localhost/me', 'https://localhost')).toBeNull();
  });

  it('keeps a thesciclub.com link inside the app', () => {
    expect(linkTarget('https://thesciclub.com/events/1?from=x#going', app)).toEqual({
      inside: '/events/1?from=x#going',
    });
    expect(linkTarget('https://www.thesciclub.com/chat', app)).toEqual({ inside: '/chat' });
  });

  it('opens one of its own pages meant for a new tab from the website, in the in-app browser', () => {
    expect(linkTarget('/terms', app, true)).toEqual({ outside: 'https://thesciclub.com/terms' });
    expect(linkTarget('capacitor://localhost/privacy#photos', app, true)).toEqual({
      outside: 'https://thesciclub.com/privacy#photos',
    });
    expect(linkTarget('mailto:hello@thesciclub.com', app, true)).toBeNull();
  });

  it('opens any other site in the in-app browser', () => {
    expect(linkTarget('https://norcalsci.org/events', app)).toEqual({
      outside: 'https://norcalsci.org/events',
    });
  });
});

describe('a link that opened the app', () => {
  const app = 'capacitor://localhost';

  it('is routed inside it, query and all', () => {
    expect(openedLinkPath('https://thesciclub.com/join?invite=tok-1', app)).toBe(
      '/join?invite=tok-1',
    );
    expect(
      openedLinkPath('https://thesciclub.com/auth/confirm.html?type=email&token_hash=h', app),
    ).toBe('/auth/confirm.html?type=email&token_hash=h');
    expect(openedLinkPath('https://www.thesciclub.com/events/7', app)).toBe('/events/7');
  });

  it('is left alone when it is not the club’s: Google’s return to its own scheme, another site', () => {
    expect(
      openedLinkPath('com.googleusercontent.apps.123-abc:/oauth2redirect?code=x', app),
    ).toBeNull();
    expect(openedLinkPath('https://norcalsci.org/join', app)).toBeNull();
  });
});

// A link can carry a sign-in (20261115100000): what it may sign in to and
// send the app to is the security of it.
describe('a link that opened the app with a sign-in', () => {
  const app = 'capacitor://localhost';
  const code = 'A'.repeat(43);

  it('takes the page and the code from "Open in the app" and from the banner, and drops the code from the address', () => {
    expect(
      readOpenedLink(
        `thesciclub://open?path=${encodeURIComponent('/events/7?invite=t')}&code=${code}`,
        app,
      ),
    ).toEqual({ path: '/events/7?invite=t', code });
    expect(
      readOpenedLink(`https://thesciclub.com/peers?tab=near&app_handoff=${code}`, app),
    ).toEqual({ path: '/peers?tab=near', code });
    expect(readOpenedLink('https://thesciclub.com/join?invite=tok-1', app)).toEqual({
      path: '/join?invite=tok-1',
      code: null,
    });
  });

  it('sends the app to no other site, and signs nothing in with a code that is not one', () => {
    expect(readOpenedLink(`thesciclub://open?path=//evil.example/x&code=${code}`, app)).toBeNull();
    expect(
      readOpenedLink(`thesciclub://open?path=https://evil.example&code=${code}`, app),
    ).toBeNull();
    expect(readOpenedLink(`https://norcalsci.org/x?app_handoff=${code}`, app)).toBeNull();
    expect(readOpenedLink('thesciclub://open?path=/home&code=short', app)).toEqual({
      path: '/home',
      code: null,
    });
    expect(
      readOpenedLink('com.googleusercontent.apps.123-abc:/oauth2redirect?code=x', app),
    ).toBeNull();
  });
});

describe('a tapped notification', () => {
  const app = 'capacitor://localhost';

  it('opens its address inside the app', () => {
    expect(notificationPath({ url: '/chat/t/1?message=2', aps: {} }, app)).toBe(
      '/chat/t/1?message=2',
    );
    expect(notificationPath({ url: '/admin?tab=reports#blocks' }, app)).toBe(
      '/admin?tab=reports#blocks',
    );
    // The tag push-notify adds, for the app to clear that one (20261028900000).
    expect(notificationPath({ url: '/events/e1?n=event%3Ae1' }, app)).toBe(
      '/events/e1?n=event%3Ae1',
    );
  });

  it('opens nothing that is not the club’s', () => {
    expect(notificationPath({ url: '//evil.example/x' }, app)).toBeNull();
    expect(notificationPath({ url: 'https://evil.example/x' }, app)).toBeNull();
    expect(notificationPath({ url: 'javascript:alert(1)' }, app)).toBeNull();
    expect(notificationPath({}, app)).toBeNull();
    expect(notificationPath(null, app)).toBeNull();
  });
});

describe('Android’s back button', () => {
  it('closes a sheet, then goes back, then leaves', () => {
    expect(backStep(true, true)).toBe('close');
    expect(backStep(false, true)).toBe('back');
    expect(backStep(false, false)).toBe('leave');
  });
});

describe('the status bar', () => {
  it('has dark words on a light page and light words on a dark one', () => {
    expect(barStyle({ appearance: 'light' }, true)).toBe('LIGHT');
    expect(barStyle({ appearance: 'dark' }, false)).toBe('DARK');
    expect(barStyle({ appearance: 'system' }, true)).toBe('DARK');
    expect(barStyle({ appearance: 'system' }, false)).toBe('LIGHT');
    // /join is always light.
    expect(barStyle({ appearance: 'dark', forceLight: '' }, true)).toBe('LIGHT');
  });
});

describe('starting the shell', () => {
  const navigate = vi.fn();
  let stop: () => void = () => undefined;

  beforeEach(() => {
    native.calls = [];
    native.back = null;
    native.resume = null;
    native.opened = null;
    native.textSize = 1;
    navigate.mockClear();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    document.documentElement.dataset.appearance = 'system';
    stop = startNativeShell(navigate);
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('--system-text-scale');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  // The owner, 2026-11-07: a chat's box was half under the keyboard.
  it('makes room for the keyboard by its own height, and gives it back', () => {
    const root = document.documentElement;
    native.keyboard.get('keyboardWillShow')?.({ keyboardHeight: 336.4 });
    expect(root.dataset.keyboard).toBe('');
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('336px');
    native.keyboard.get('keyboardDidShow')?.({ keyboardHeight: 380 });
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('380px');
    native.keyboard.get('keyboardWillHide')?.({ keyboardHeight: 0 });
    expect(root.dataset.keyboard).toBeUndefined();
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('');
  });

  it('hides the splash and paints the status bar for the page', async () => {
    await vi.waitFor(() => {
      expect(native.calls).toEqual(['bar LIGHT', 'splash hidden']);
    });
  });

  it('moves every screen below the status bar, and stops when it stops', () => {
    expect(document.documentElement.dataset.nativeApp).toBe('');
    stop();
    expect(document.documentElement.dataset.nativeApp).toBeUndefined();
  });

  it('opens another site in the in-app browser instead of in place of the club', () => {
    document.body.innerHTML = '<a href="https://norcalsci.org/" target="_blank">NorCal SCI</a>';
    const link = document.querySelector('a');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(native.calls).toContain('browser https://norcalsci.org/');
  });

  it('opens the Terms from a step of joining in the in-app browser, not nowhere', () => {
    document.body.innerHTML = '<a href="/terms" target="_blank">Terms of Service</a>';
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(native.calls).toContain('browser https://thesciclub.com/terms');
  });

  it('follows a thesciclub.com link inside the app', () => {
    document.body.innerHTML = '<a href="https://thesciclub.com/events/7">An event</a>';
    document.querySelector('a')?.click();
    expect(navigate).toHaveBeenCalledWith('/events/7');
  });

  it('routes a link that opened the app, an invite say, inside it', () => {
    native.opened?.({ url: 'https://thesciclub.com/join?invite=tok-1' });
    expect(navigate).toHaveBeenCalledWith('/join?invite=tok-1');
    native.opened?.({ url: 'com.googleusercontent.apps.123-abc:/oauth2redirect' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('leaves the app’s own links alone', () => {
    document.body.innerHTML = '<a href="/me">Me</a>';
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('closes an open sheet on back, before going anywhere', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    native.back?.({ canGoBack: true });
    window.removeEventListener('keydown', heard);
    expect((heard.mock.calls[0]?.[0] as KeyboardEvent | undefined)?.key).toBe('Escape');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes back past a sheet left open in a hidden tab', () => {
    document.body.innerHTML =
      '<div style="display: none !important;"><div role="dialog" aria-modal="true"></div></div>';
    native.back?.({ canGoBack: true });
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('goes back, and at the first screen puts the app away', () => {
    native.back?.({ canGoBack: true });
    expect(navigate).toHaveBeenCalledWith(-1);
    native.back?.({ canGoBack: false });
    expect(native.calls).toContain('minimize');
  });

  it('repaints the status bar when the member switches to dark', async () => {
    document.documentElement.dataset.appearance = 'dark';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.calls).toContain('bar DARK');
  });
});

describe('the iPhone’s Text Size', () => {
  it('multiplies the club’s own sizes, and never makes text smaller', () => {
    expect(systemTextScale(0.82)).toBe(1);
    expect(systemTextScale(1)).toBe(1);
    expect(systemTextScale(1.2353)).toBe(1.24);
    expect(systemTextScale(3.1176)).toBe(3.12);
    expect(systemTextScale(Number.NaN)).toBe(1);
  });

  const root = document.documentElement;
  const scale = () => root.style.getPropertyValue('--system-text-scale');
  let stop: () => void = () => undefined;

  beforeEach(() => {
    native.calls = [];
    native.textSize = 1;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    root.style.removeProperty('--system-text-scale');
  });

  it('is applied on an iPhone before the splash goes, and again on coming back', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    native.textSize = 1.47;
    stop = startNativeShell(vi.fn());
    await vi.waitFor(() => {
      expect(native.calls).toContain('splash hidden');
    });
    expect(native.calls.indexOf('text size read')).toBeLessThan(
      native.calls.indexOf('splash hidden'),
    );
    expect(scale()).toBe('1.47');

    native.textSize = 0.9;
    native.resume?.();
    await vi.waitFor(() => {
      expect(scale()).toBe('1');
    });
  });

  it('routes native notification taps on iPhone and configured Android', () => {
    const navigate = vi.fn();
    native.tapped = null;
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    stop = startNativeShell(navigate);
    expect(native.tapped).toBeNull();
    stop();

    vi.stubEnv('VITE_ANDROID_PUSH', 'true');
    stop = startNativeShell(navigate);
    tapNotification('/chat/t/1?n=thread');
    expect(navigate).toHaveBeenCalledWith('/chat/t/1?n=thread');
    stop();
    vi.unstubAllEnvs();

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    stop = startNativeShell(navigate);
    tapNotification('/events/7');
    expect(navigate).toHaveBeenCalledWith('/events/7');
  });

  it('is left to Android, whose web view follows it already', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    native.textSize = 1.3;
    stop = startNativeShell(vi.fn());
    await vi.waitFor(() => {
      expect(native.calls).toContain('splash hidden');
    });
    expect(native.calls).not.toContain('text size read');
    expect(scale()).toBe('');
  });
});
