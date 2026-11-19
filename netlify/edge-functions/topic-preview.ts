/**
 * What a text message shows for a link to a question (the owner, 2026-11-16:
 * "be thoughtful about what image the website brings up in chat for the copied
 * link ... the question or the first bit of it in the preview text").
 *
 * The club is private, so the words are shown only for a link an administrator
 * made to let people in (?from=<code>, 20261116200000), while its code is live
 * and was made for this very topic (shared_topic_preview): they chose to show
 * it to whoever gets the link. Any other link to a post previews as the club,
 * with no words of anybody's.
 *
 * As event-preview.ts: only what fetches previews is answered here, by the name
 * it gives; a member's browser goes straight on to the app. iMessage shows the
 * title and the picture, not the description, so the question is the title.
 * The picture is the club's own, as on every other link (the owner: "the sci
 * club is fine. Just the title of the page could be the question").
 */

import { isPreviewer } from './event-preview.ts';

const SITE = 'https://thesciclub.com';
const ICON = `${SITE}/favicon-512x512.png`;
/** Long enough for most questions; a message cuts a long title anyway. */
const TITLE_MAX = 110;

const TOPIC_PATH =
  /^\/chat\/rooms\/[^/]+\/topics\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function topicIdIn(path: string): string | null {
  return TOPIC_PATH.exec(path)?.[1] ?? null;
}

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The question, whole if it fits, else cut at a word with an ellipsis. */
export function questionTitle(title: string): string {
  const words = title.replace(/\s+/g, ' ').trim();
  if (words.length <= TITLE_MAX) return words;
  const cut = words.slice(0, TITLE_MAX - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > 60 ? cut.slice(0, atWord) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/**
 * A question shared to let people in: its words, and a call to answer it (the
 * owner, 2026-11-16: "Help answer inside theSCIClub and contribute to our
 * knowledge base", in place of who invited them).
 */
export function sharedQuestionPage(shared: { title: string }, url: string): string {
  const title = escaped(questionTitle(shared.title));
  const description = escaped(
    'Help answer inside The SCI Club and contribute to our knowledge base.',
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="The SCI Club" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escaped(url)}" />
<meta property="og:image" content="${ICON}" />
<meta name="twitter:card" content="summary" />
</head>
<body><a href="${escaped(url)}">${title}</a></body>
</html>`;
}

/** Any other link to a post: the club, and nothing of what is in it. */
export function privatePostPage(url: string): string {
  const title = 'A post on The SCI Club';
  const description =
    'Members only. The SCI Club is a private community where we help each other navigate life after a spinal cord injury.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="The SCI Club" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escaped(url)}" />
<meta property="og:image" content="${ICON}" />
<meta name="twitter:card" content="summary" />
</head>
<body><a href="${escaped(url)}">${title}</a></body>
</html>`;
}

declare const Netlify: { env: { get(name: string): string | undefined } };

async function readShared(
  base: string,
  key: string,
  code: string,
  topic: string,
): Promise<{ title: string } | null> {
  const response = await fetch(`${base}/rest/v1/rpc/shared_topic_preview`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_code: code, p_topic: topic }),
  });
  if (!response.ok) return null;
  // The title only: who shared it is never said (the owner, 2026-11-19).
  const rows = (await response.json()) as { title?: unknown }[];
  const row = rows[0];
  return typeof row?.title === 'string' ? { title: row.title } : null;
}

function page(html: string): Response {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

export default async function topicPreview(
  request: Request,
  context: { next: () => Promise<Response> },
): Promise<Response> {
  const url = new URL(request.url);
  const topic = topicIdIn(url.pathname);
  if (!topic || !isPreviewer(request.headers.get('user-agent'))) return await context.next();
  const shown = `${SITE}${url.pathname}${url.search}`;
  const code = url.searchParams.get('from')?.trim();
  const base = Netlify.env.get('VITE_SUPABASE_URL');
  const key = Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  if (!code || !base || !key) return page(privatePostPage(shown));
  try {
    const shared = await readShared(base, key, code, topic);
    return page(shared ? sharedQuestionPage(shared, shown) : privatePostPage(shown));
  } catch {
    return page(privatePostPage(shown));
  }
}
