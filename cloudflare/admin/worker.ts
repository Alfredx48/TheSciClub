/**
 * admin.thesciclub.com's Worker (the owner, 2026-11-22). The admin site is static assets; this
 * runs only for /app-status: whether the members' app is answering, read from its /version.json
 * here because the app does not let other sites read it from a browser. APP_ORIGIN is set per
 * site in wrangler.toml.
 */
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  APP_ORIGIN: string;
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
    return env.ASSETS.fetch(request);
  },
};
