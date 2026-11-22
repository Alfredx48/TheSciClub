import { describe, expect, it } from 'vitest';
import worker, { type Env } from './worker';

/**
 * The owner, 2026-11-21: the installed app showed Safari's "Response served by service worker
 * has redirections". Its worker asks for /index.html by that name, and the assets answered with
 * a 307 to /; Netlify had answered with the page.
 */
describe('the site on Cloudflare', () => {
  it('answers /index.html with the page itself, not a redirect', async () => {
    const asked: string[] = [];
    const env: Env = {
      ASSETS: {
        fetch: (request: Request) => {
          const path = new URL(request.url).pathname;
          asked.push(path);
          return Promise.resolve(
            path === '/index.html'
              ? new Response(null, { status: 307, headers: { location: '/' } })
              : new Response('<!doctype html>', { status: 200 }),
          );
        },
      },
    };
    const response = await worker.fetch(new Request('https://thesciclub.com/index.html'), env);
    expect(response.status).toBe(200);
    expect(asked).toEqual(['/']);
  });
});
