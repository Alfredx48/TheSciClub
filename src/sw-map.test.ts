import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn(), copyResponse: vi.fn() }));
vi.mock('workbox-precaching', () => ({
  addPlugins: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
  precacheAndRoute: vi.fn(),
}));
vi.mock('workbox-routing', () => ({ NavigationRoute: vi.fn(), registerRoute: vi.fn() }));

const origin = 'https://thesciclub.com';
const kept = new Map<string, Response>();
const storage = { full: false };

vi.stubGlobal('self', {
  location: { origin },
  __WB_MANIFEST: [],
  skipWaiting: vi.fn(),
  clients: {},
  addEventListener: vi.fn(),
});
vi.stubGlobal('caches', {
  open: () =>
    Promise.resolve({
      match: (request: Request) => Promise.resolve(kept.get(request.url)?.clone()),
      put: (request: Request, response: Response) => {
        if (storage.full)
          return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'));
        kept.set(request.url, response);
        return Promise.resolve();
      },
      keys: () => Promise.resolve([...kept.keys()].map((url) => new Request(url))),
      delete: (request: Request) => Promise.resolve(kept.delete(request.url)),
    }),
});

const { isMapFile, mapFile } = await import('./sw');

const OLD = `${origin}/assets/maplibre-AAAAAAAA.js`;
const NEW = `${origin}/assets/maplibre-BBBBBBBB.js`;

function serve(body: string, type: string) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': type } })),
  );
}

beforeEach(() => {
  storage.full = false;
  kept.clear();
  kept.set(OLD, new Response('old map', { headers: { 'content-type': 'text/javascript' } }));
});

describe("the map's files in the service worker", () => {
  it('keeps a new build of a file in place of the old', async () => {
    serve('new map', 'text/javascript');
    await mapFile({ request: new Request(NEW), url: new URL(NEW) });
    expect([...kept.keys()]).toEqual([NEW]);
  });

  it("never keeps the site's index.html served for a file that is gone", async () => {
    serve('<!doctype html>', 'text/html; charset=utf-8');
    const response = await mapFile({ request: new Request(NEW), url: new URL(NEW) });
    expect(response.headers.get('content-type')).toContain('text/html');
    expect([...kept.keys()]).toEqual([OLD]);
  });

  it('wants each kind of file to say what it is', () => {
    expect(isMapFile('/assets/maplibre-x.css', 'text/css')).toBe(true);
    expect(isMapFile('/assets/maplibre-x.js', 'application/octet-stream')).toBe(false);
    expect(isMapFile('/map/v1/sprites/light.json', 'application/json')).toBe(true);
    expect(isMapFile('/map/v1/fonts/a/0-255.pbf', 'application/x-protobuf')).toBe(true);
    expect(isMapFile('/map/v1/fonts/a/0-255.pbf', 'text/html')).toBe(false);
  });

  it('still answers the page when storage is full, and keeps the old copy', async () => {
    storage.full = true;
    serve('new map', 'text/javascript');
    const response = await mapFile({ request: new Request(NEW), url: new URL(NEW) });
    expect(await response.text()).toBe('new map');
    expect([...kept.keys()]).toEqual([OLD]);
  });

  it('answers a glyph it has from the device, without the network', async () => {
    const glyphs = `${origin}/map/v1/fonts/Noto%20Sans%20Regular/0-255.pbf`;
    kept.set(glyphs, new Response('kept glyphs'));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const response = await mapFile({ request: new Request(glyphs), url: new URL(glyphs) });
    expect(await response.text()).toBe('kept glyphs');
  });

  it("drops an older folder's glyphs once the new folder's are in", async () => {
    const v1 = `${origin}/map/v1/fonts/Noto%20Sans%20Regular/0-255.pbf`;
    const v2 = `${origin}/map/v2/fonts/Noto%20Sans%20Regular/0-255.pbf`;
    kept.set(v1, new Response('old glyphs'));
    serve('new glyphs', 'application/x-protobuf');
    await mapFile({ request: new Request(v2), url: new URL(v2) });
    expect([...kept.keys()]).toContain(v2);
    expect([...kept.keys()]).not.toContain(v1);
  });
});
