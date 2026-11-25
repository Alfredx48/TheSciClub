/**
 * admin.thesciclub.com's Worker (the owner, 2026-11-22). The admin site is static assets; this
 * runs only for /app-status: whether the members' app is answering, read from its /version.json
 * here because the app does not let other sites read it from a browser. APP_ORIGIN is set per
 * site in wrangler.toml.
 *
 * And for /on-tests/ (the owner, 2026-11-25): what the change log says is waiting on the test
 * site. This site is built only when main is pushed; the test site is built on every push to
 * tests and lists what main does not have yet (admin/changes.mjs waiting), so that list and its
 * screenshots are fetched from TESTS_ORIGIN here. Only those two shapes of address are passed on.
 */
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  APP_ORIGIN: string;
  TESTS_ORIGIN: string;
}

const ON_TESTS = /^\/on-tests\/(on-tests\.json|shots\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp))$/;

/** The test site's change-log file for an /on-tests/ address, or null: nothing else is fetched. */
export function onTestsUrl(pathname: string, testsOrigin: string): string | null {
  const match = ON_TESTS.exec(pathname);
  return match?.[1] && !match[1].includes('..') ? `${testsOrigin}/change-log/${match[1]}` : null;
}

async function onTests(target: string): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  try {
    const response = await fetch(target, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const type = response.headers.get('Content-Type') ?? '';
    // The test site answers an address it does not have with its page: that is not the file.
    if (!response.ok || type.startsWith('text/html')) {
      return new Response('Not on the test site.', { status: 404, headers });
    }
    return new Response(response.body, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response('The test site did not answer.', { status: 502, headers });
  }
}

export interface AppStatus {
  up: boolean;
  status: number | null;
  ms: number | null;
  built: string | null;
}

export async function appStatus(origin: string, fetcher: typeof fetch = fetch): Promise<AppStatus> {
  const started = Date.now();
  try {
    const response = await fetcher(`${origin}/version.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - started;
    if (!response.ok) return { up: false, status: response.status, ms, built: null };
    const body = (await response.json().catch(() => null)) as { built?: unknown } | null;
    return {
      up: true,
      status: response.status,
      ms,
      built: typeof body?.built === 'string' ? body.built : null,
    };
  } catch {
    return { up: false, status: null, ms: null, built: null };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/app-status') {
      return Response.json(await appStatus(env.APP_ORIGIN), {
        headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
      });
    }
    if (url.pathname.startsWith('/on-tests/')) {
      const target = request.method === 'GET' ? onTestsUrl(url.pathname, env.TESTS_ORIGIN) : null;
      return target ? onTests(target) : new Response('Not found.', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
