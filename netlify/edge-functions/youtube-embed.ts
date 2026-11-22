/**
 * Headers for the store app's YouTube page, public/embed/youtube.html.
 * Set here, not in netlify.toml, because Netlify did not reliably pick the
 * page's rule over "/*" (frame-ancestors 'none'), and the app showed white.
 * Declared for exactly that path in netlify.toml; src/embed-youtube.test.ts
 * checks these against the page.
 */

/** Only the iPhone app, the Android app and the club may frame the page. */
export const FRAME_ANCESTORS = [
  // capacitor: too, in case WebKit does not match a custom-scheme host source.
  'capacitor:',
  'capacitor://localhost',
  'https://localhost',
  'https://thesciclub.com',
];

export const EMBED_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'sha256-VD9mqexzzVRELswuLvp/8vQyyPj6rqtG47uhpk7/BZ4='",
    "style-src 'sha256-pTXWBUXwSv2U25eVaY4YmGaJreAcdJZXGVEK/Ol4afw='",
    'frame-src https://www.youtube-nocookie.com',
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${FRAME_ANCESTORS.join(' ')}`,
  ].join('; '),
  // Ignored where frame-ancestors is understood.
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, max-age=300',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

interface Context {
  next(): Promise<Response>;
}

export default async function youtubeEmbed(_request: Request, context: Context) {
  const upstream = await context.next();
  // A copy, as a fetched response's headers may be read-only.
  const response = new Response(upstream.body, upstream);
  for (const [name, value] of Object.entries(EMBED_HEADERS)) response.headers.set(name, value);
  return response;
}
