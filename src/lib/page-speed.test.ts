import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cardsShown,
  endpointOf,
  flush,
  measuredVisit,
  noteScreen,
  ONE_VISIT_IN,
  openingSteps,
  resetPageSpeed,
  screenOf,
  startPageSpeed,
  timedFetch,
} from '@/lib/page-speed';

const BASE = 'https://project.supabase.co';

afterEach(() => {
  resetPageSpeed();
});

describe('a screen, as its pattern', () => {
  it('never says which event, person or chat', () => {
    expect(screenOf('/events/836de9c7-9b0e-4931-bd07-1aa6901ebbbf')).toBe('/events/:id');
    expect(screenOf('/events/836de9c7/guests')).toBe('/events/:id/guests');
    expect(screenOf('/peers/dana-ruiz')).toBe('/peers/:id');
    expect(screenOf('/chat/rooms/r1/topics/t9')).toBe('/chat/rooms/:id/topics/:id');
  });

  it('keeps the screens that have a name of their own', () => {
    expect(screenOf('/events/new')).toBe('/events/new');
    expect(screenOf('/chat/rooms/new')).toBe('/chat/rooms/new');
    expect(screenOf('/home')).toBe('/home');
  });

  it('calls anything else other, rather than keeping the address', () => {
    expect(screenOf('/somebody/typed/this')).toBe('/other');
  });
});

describe('what a request asked for', () => {
  it('names it without its arguments', () => {
    expect(endpointOf(`${BASE}/rest/v1/rpc/map_events?x=1`)).toBe('rpc:map_events');
    expect(endpointOf(`${BASE}/rest/v1/members?select=id&email=eq.dana@example.com`)).toBe(
      'table:members',
    );
    expect(endpointOf(`${BASE}/auth/v1/token?grant_type=refresh_token`)).toBe('auth:token');
    expect(endpointOf(`${BASE}/functions/v1/send-invite`)).toBe('fn:send-invite');
    expect(endpointOf(`${BASE}/storage/v1/object/avatars/me.jpg`)).toBe('storage');
  });

  // The load-test branch's own calls.
  it('names the badge and topic calls', () => {
    for (const name of ['my_badge_counts', 'chat_topic_for', 'chat_topics_page']) {
      expect(endpointOf(`${BASE}/rest/v1/rpc/${name}`)).toBe(`rpc:${name}`);
    }
  });

  it('ignores what is not the club', () => {
    expect(endpointOf('https://example.com/x')).toBeNull();
    expect(endpointOf('not a url')).toBeNull();
  });
});

describe('timing requests', () => {
  it('times each request and sends them in a batch', async () => {
    const sent: unknown[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    const base = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
    const fetcher = timedFetch(base);
    await fetcher(`${BASE}/rest/v1/rpc/map_events`, {});
    await fetcher(`${BASE}/rest/v1/rpc/events_within_miles`, {});
    flush();
    expect(base).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      expect.objectContaining({ kind: 'request', metric: 'rpc:map_events', ok: true }),
      expect.objectContaining({ kind: 'request', metric: 'rpc:events_within_miles' }),
    ]);
  });

  it('says a request failed, and still lets the error through', async () => {
    const sent: { ok: boolean }[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    const fetcher = timedFetch(() => Promise.reject(new Error('offline')));
    await expect(fetcher(`${BASE}/rest/v1/members`, {})).rejects.toThrow('offline');
    flush();
    expect(sent[0]?.[0]?.ok).toBe(false);
  });

  // The owner, 2026-11-21: 24 "failed" requests were a robot leaving Chat
  // before they finished. Why one failed is kept; a cancelled one is not one.
  it('says why a request failed, and leaves out one cancelled by leaving the screen', async () => {
    const sent: { metric: string; ok: boolean; failure?: string }[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    await timedFetch(() => Promise.resolve(new Response('', { status: 500 })))(
      `${BASE}/rest/v1/rpc/home_feed`,
      {},
    );
    await expect(
      timedFetch(() => Promise.reject(new TypeError('Load failed')))(`${BASE}/rest/v1/events`, {}),
    ).rejects.toThrow();
    const leaving = new AbortController();
    leaving.abort();
    await expect(
      timedFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')))(
        `${BASE}/rest/v1/chat_rooms`,
        { signal: leaving.signal },
      ),
    ).rejects.toThrow();
    flush();
    expect(sent.flat().map(({ metric, ok, failure }) => ({ metric, ok, failure }))).toEqual([
      { metric: 'rpc:home_feed', ok: false, failure: '500' },
      { metric: 'table:events', ok: false, failure: 'no connection' },
    ]);
  });

  it('does not time its own log call', async () => {
    const sent: unknown[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    const fetcher = timedFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await fetcher(`${BASE}/rest/v1/rpc/log_page_speed`, {});
    flush();
    expect(sent).toEqual([]);
  });

  // The owner, 2026-11-21: nothing is sent while the app is in use, so a report never
  // competes with a screen loading; it goes, with keepalive, when the page is put away.
  it('sends only once the page is put away, with keepalive, each sample saying its release', async () => {
    const sent: { release: string }[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    const base = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('[]', { status: 200 })),
    );
    const fetcher = timedFetch(base);
    for (let i = 0; i < 60; i++) await fetcher(`${BASE}/rest/v1/members`, {});
    expect(sent).toEqual([]);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(sent.map((batch) => batch.length)).toEqual([50, 10]);
    expect(sent[0]?.[0]).toHaveProperty('release');
    await fetcher(`${BASE}/rest/v1/rpc/log_page_speed`, {});
    expect(base.mock.lastCall?.[1]).toMatchObject({ keepalive: true });
  });

  // The owner, 2026-11-21: a visit put away within 5 seconds sent no opening times.
  it('sends the opening times at once if the app is put away before they settle', () => {
    const entries = vi
      .spyOn(performance, 'getEntriesByType')
      .mockImplementation((type: string) =>
        type === 'paint'
          ? ([{ name: 'first-contentful-paint', startTime: 640 }] as PerformanceEntryList)
          : type === 'navigation'
            ? ([
                { responseStart: 120, domContentLoadedEventEnd: 0 },
              ] as unknown as PerformanceEntryList)
            : [],
      );
    const sent: { metric: string; ms: number }[][] = [];
    startPageSpeed((samples) => {
      sent.push(samples);
      return Promise.resolve();
    }, true);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const opening = sent
      .flat()
      .filter((s) => ['first-byte', 'ready', 'first-paint'].includes(s.metric));
    // Ready had not happened yet, so it is left out rather than sent as 0.
    expect(opening.map(({ metric, ms }) => ({ metric, ms }))).toEqual([
      { metric: 'first-byte', ms: 120 },
      { metric: 'first-paint', ms: 640 },
    ]);
    entries.mockRestore();
  });

  // The owner, 2026-11-21: the steps of an opening, for Admin's breakdown.
  it('takes the opening apart from the page\u2019s own timings', () => {
    const entries = vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
      type === 'resource'
        ? ([
            {
              initiatorType: 'script',
              name: 'https://club/assets/index-AbC123.js',
              startTime: 500,
              responseEnd: 900,
            },
            {
              initiatorType: 'script',
              name: 'https://club/assets/page-Xyz.js',
              startTime: 1800,
              responseEnd: 1900,
            },
            {
              initiatorType: 'fetch',
              name: 'https://db/rest/v1/members?select=id',
              startTime: 520,
              responseEnd: 1100,
            },
            {
              initiatorType: 'fetch',
              name: 'https://db/rest/v1/rpc/home_feed',
              startTime: 521,
              responseEnd: 1300,
            },
          ] as unknown as PerformanceEntryList)
        : [],
    );
    expect(Object.fromEntries(openingSteps())).toEqual({
      'script-loaded': 900,
      'data-asked': 520,
      'feed-arrived': 1300,
    });
    entries.mockRestore();
  });

  it('never throws when sending fails', async () => {
    startPageSpeed(() => {
      throw new Error('not configured');
    }, true);
    const fetcher = timedFetch(() => Promise.resolve(new Response('', { status: 200 })));
    await fetcher(`${BASE}/rest/v1/members`, {});
    expect(() => {
      flush();
    }).not.toThrow();
  });
});

// The owner, 2026-11-05: one visit in ten; 2026-11-21: one in three again.
describe('measuring only some visits', () => {
  it('sends nothing from a visit that is not measured, not even what came before', async () => {
    const send = vi.fn(() => Promise.resolve());
    const fetcher = timedFetch(() => Promise.resolve(new Response('[]', { status: 200 })));
    await fetcher(`${BASE}/rest/v1/members`, {});
    startPageSpeed(send, false);
    await fetcher(`${BASE}/rest/v1/rpc/map_events`, {});
    flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('measures one visit in three', async () => {
    expect(ONE_VISIT_IN).toBe(3);
    const random = vi.spyOn(Math, 'random');
    const send = vi.fn(() => Promise.resolve());
    const fetcher = timedFetch(() => Promise.resolve(new Response('[]', { status: 200 })));

    random.mockReturnValue(0.33);
    startPageSpeed(send);
    await fetcher(`${BASE}/rest/v1/members`, {});
    flush();
    expect(send).toHaveBeenCalledTimes(1);

    // Not measured past a third.
    resetPageSpeed();
    random.mockReturnValue(0.34);
    startPageSpeed(send);
    await fetcher(`${BASE}/rest/v1/members`, {});
    flush();
    expect(send).toHaveBeenCalledTimes(1);
    random.mockRestore();
  });

  it('measures about a third of many page loads', () => {
    const loads = 50_000;
    let measured = 0;
    for (let i = 0; i < loads; i++) if (measuredVisit()) measured += 1;
    expect(measured / loads).toBeGreaterThan(0.32);
    expect(measured / loads).toBeLessThan(0.35);
  });

  it('keeps one visit’s requests together under one id', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const send = vi.fn((_samples: { visit: string }[]) => Promise.resolve());
    const fetcher = timedFetch(() => Promise.resolve(new Response('[]', { status: 200 })));
    startPageSpeed(send);
    await fetcher(`${BASE}/rest/v1/members`, {});
    await fetcher(`${BASE}/rest/v1/rpc/map_events`, {});
    flush();
    random.mockRestore();
    const batch = send.mock.calls[0]?.[0] ?? [];
    expect(batch).toHaveLength(2);
    expect(new Set(batch.map((s) => s.visit)).size).toBe(1);
  });
});

// The owner, 2026-11-04: time until the cards on Events and Peers are drawn
// with their data.
describe('cards shown', () => {
  interface Sent {
    metric: string;
    screen: string;
    ms: number;
  }
  function sending() {
    const sent: Sent[] = [];
    startPageSpeed((samples) => {
      sent.push(...(samples as Sent[]));
      return Promise.resolve();
    }, true);
    // Drawn at once, rather than at the next two frames.
    vi.stubGlobal('requestAnimationFrame', (step: FrameRequestCallback) => {
      step(performance.now());
      return 0;
    });
    return sent;
  }
  const go = (path: string) => {
    window.history.pushState({}, '', path);
    noteScreen(path);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('times from opening the app, through a redirect', () => {
    const sent = sending();
    go('/');
    go('/events');
    cardsShown();
    flush();
    expect(sent).toEqual([
      expect.objectContaining({ metric: 'cards-after-open', screen: '/events' }),
    ]);
  });

  it('times from the tap once somebody has moved to the screen', () => {
    const sent = sending();
    go('/home');
    window.dispatchEvent(new Event('pointerdown'));
    go('/peers');
    cardsShown();
    flush();
    expect(sent).toEqual([
      expect.objectContaining({ metric: 'cards-after-tap', screen: '/peers' }),
    ]);
  });

  it('sends no card times from a visit that is not measured', () => {
    const send = vi.fn(() => Promise.resolve());
    startPageSpeed(send, false);
    vi.stubGlobal('requestAnimationFrame', (step: FrameRequestCallback) => {
      step(performance.now());
      return 0;
    });
    go('/events');
    cardsShown();
    flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('times a visit once, and only on the screen it is on', () => {
    const sent = sending();
    go('/events');
    cardsShown();
    cardsShown();
    window.dispatchEvent(new Event('pointerdown'));
    noteScreen('/peers');
    // Still at /events in the address: a late call from the last screen.
    cardsShown();
    flush();
    expect(sent).toHaveLength(1);
  });
});
