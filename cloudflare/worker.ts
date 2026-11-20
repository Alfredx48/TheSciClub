/**
 * The site on Cloudflare (the owner, 2026-11-20: Netlify's credits ran out on
 * deploys). The built app is served as static assets (wrangler.toml, [assets]);
 * this script runs only for the paths in run_worker_first, the ones the three
 * Netlify edge functions answered, and runs those same functions unchanged.
 *
 * They read their settings as Netlify.env.get(...) and serve the page with
 * context.next(); here Netlify's env is the Worker's vars and next() is the
 * asset that would have been served.
 */

import eventPreview from '../netlify/edge-functions/event-preview.ts';
import topicPreview from '../netlify/edge-functions/topic-preview.ts';
import youtubeEmbed from '../netlify/edge-functions/youtube-embed.ts';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

type Handler = (request: Request, context: { next: () => Promise<Response> }) => Promise<Response>;

/** Which edge function answers a path, as netlify.toml's [[edge_functions]] said. */
export function handlerFor(path: string): Handler | null {
  // /embed/youtube too: the assets redirect a .html path to the one without.
  if (path === '/embed/youtube.html' || path === '/embed/youtube') return youtubeEmbed;
  if (path === '/e' || path.startsWith('/e/')) return eventPreview;
  if (path === '/events' || path.startsWith('/events/')) return eventPreview;
  if (path.startsWith('/chat/rooms/')) return topicPreview;
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const settings: Record<string, string | undefined> = {
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
    };
    (globalThis as { Netlify?: unknown }).Netlify = {
      env: { get: (name: string) => settings[name] },
    };
    const url = new URL(request.url);
    // The assets answer a .html path with a redirect to the path without; the
    // app frames /embed/youtube.html, so that page is served where it is asked.
    const asset =
      url.pathname === '/embed/youtube.html'
        ? new Request(new URL(`/embed/youtube${url.search}`, url), request)
        : request;
    const next = () => env.ASSETS.fetch(asset);
    const handler = handlerFor(url.pathname);
    return handler ? await handler(request, { next }) : await next();
  },
};
