import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATE, PENDING } from '@/lib/push/payload';

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn(), copyResponse: vi.fn() }));
vi.mock('workbox-precaching', () => ({
  addPlugins: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
  precacheAndRoute: vi.fn(),
}));
vi.mock('workbox-routing', () => ({ NavigationRoute: vi.fn(), registerRoute: vi.fn() }));

const origin = 'https://thesciclub.com';
let listeners: Record<string, (event: unknown) => void>;
const saved = new Map<string, Response>();
let clients: { matchAll: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn> };

async function loadWorker() {
  vi.resetModules();
  listeners = {};
  vi.stubGlobal('self', {
    location: { origin },
    __WB_MANIFEST: [],
    skipWaiting: vi.fn(),
    clients,
    addEventListener: (kind: string, listener: (event: unknown) => void) => {
      listeners[kind] = listener;
    },
  });
  await import('./sw');
}

beforeEach(async () => {
  saved.clear();
  clients = {
    matchAll: vi.fn().mockResolvedValue([]),
    openWindow: vi.fn().mockResolvedValue(null),
  };
  vi.stubGlobal('caches', {
    open: () =>
      Promise.resolve({
        put: (key: string, response: Response) => {
          saved.set(key, response);
          return Promise.resolve();
        },
        match: (key: string) => Promise.resolve(saved.get(key)?.clone()),
        delete: (key: string) => Promise.resolve(saved.delete(key)),
      }),
  });
  // A paired channel, including the acknowledgement returned by the app.
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    },
  );
  await loadWorker();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function windowClient(url = '/home') {
  return {
    type: 'window',
    url: `${origin}${url}`,
    focused: false,
    focus: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(null),
    postMessage: vi.fn((_message: unknown, ports: { postMessage: (data: unknown) => void }[]) => {
      ports[0]?.postMessage({ ok: true });
    }),
  };
}

async function click(path: string) {
  let work: Promise<unknown> = Promise.resolve();
  const close = vi.fn();
  listeners.notificationclick?.({
    notification: { data: { url: path }, close },
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  expect(close).toHaveBeenCalledOnce();
}

async function collect(source: ReturnType<typeof windowClient>) {
  let work: Promise<unknown> = Promise.resolve();
  listeners.message?.({
    data: { type: PENDING },
    source,
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
}

describe('system notification clicks', () => {
  it.each(['/chat/t/thread?message=m1', '/chat/rooms/bowel/topics/topic?post=p1'])(
    'delivers %s even when focus rejects',
    async (path) => {
      const client = windowClient();
      client.focus.mockRejectedValue(new Error('Window not focusable'));
      clients.matchAll.mockResolvedValue([client]);
      await click(path);
      expect(client.postMessage).toHaveBeenCalledWith({ type: NAVIGATE, path }, expect.any(Array));
      expect(client.navigate).not.toHaveBeenCalled();
      expect(saved.size).toBe(0);
    },
  );

  it('sends another navigation when the destination is already open', async () => {
    const path = '/chat/t/thread?message=m1';
    const client = windowClient(path);
    clients.matchAll.mockResolvedValue([client]);
    await click(path);
    expect(client.postMessage).toHaveBeenCalledWith({ type: NAVIGATE, path }, expect.any(Array));
  });

  it('keeps a click across worker restart until a starting or resumed app acknowledges it', async () => {
    const path = '/chat/rooms/cooking/topics/topic?post=p1';
    await click(path);
    expect(clients.openWindow).toHaveBeenCalledWith(path);
    await loadWorker();
    const client = windowClient();
    await collect(client);
    expect(client.postMessage).toHaveBeenCalledWith({ type: NAVIGATE, path }, expect.any(Array));
    expect(saved.size).toBe(0);
    await collect(client);
    expect(client.postMessage).toHaveBeenCalledOnce();
  });

  it('keeps an unacknowledged click when the old app cannot receive it or reload', async () => {
    const client = windowClient();
    client.postMessage.mockImplementation(() => {
      throw new Error('Suspended');
    });
    client.navigate.mockRejectedValue(new Error('Cannot navigate'));
    clients.matchAll.mockResolvedValue([client]);
    const path = '/chat/t/thread?message=m2';
    await click(path);
    const resumed = windowClient();
    await collect(resumed);
    expect(resumed.postMessage).toHaveBeenCalledWith({ type: NAVIGATE, path }, expect.any(Array));
    expect(saved.size).toBe(0);
  });

  it('expires a click so opening the app later does not redirect unexpectedly', async () => {
    await click('/chat/t/thread?message=m1');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    const client = windowClient();
    await collect(client);
    expect(client.postMessage).not.toHaveBeenCalled();
    expect(saved.size).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('the navigation fallback', () => {
  // Workbox tests the denylist against the path and the query together.
  async function denied(pathAndQuery: string) {
    const { NavigationRoute } = await import('workbox-routing');
    const options = vi.mocked(NavigationRoute).mock.calls.at(-1)?.[1];
    return (options?.denylist ?? []).some((pattern) => pattern.test(pathAndQuery));
  }

  it("leaves the store app's YouTube page to the network, query and all", async () => {
    expect(await denied('/embed/youtube.html?v=dQw4w9WgXcQ')).toBe(true);
    expect(await denied('/embed/youtube.html')).toBe(true);
  });

  it("still answers the app's own screens", async () => {
    expect(await denied('/chat')).toBe(false);
    expect(await denied('/join?invite=abc')).toBe(false);
  });
});
