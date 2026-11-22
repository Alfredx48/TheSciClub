import type { LinkPreview } from '@/lib/chat/types';
import { SITE_ORIGIN } from '@/lib/site-origin';

/**
 * A row's `link_preview`, read defensively.
 *
 * The database only stores what `link_preview_save` checked, but a column of
 * JSON is a column of anything as far as this file can see, and a card drawn
 * from a field of the wrong type is a crash in the middle of a conversation.
 * So every field is taken only if it is the shape the card expects, and a
 * preview with no address, or with nothing to draw, is no preview.
 */
export function toLinkPreview(raw: unknown): LinkPreview | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = (key: string) => {
    const value = row[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const url = text('url');
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const imagePath = text('imagePath');
  const youtubeId = text('youtubeId');
  const preview: LinkPreview = {
    url,
    title: text('title'),
    description: text('description'),
    siteName: text('siteName'),
    imagePath: imagePath && /^[0-9a-f]{64}\.(jpg|png|webp|gif)$/.test(imagePath) ? imagePath : null,
    youtubeId: youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId) ? youtubeId : null,
  };
  return preview.title || preview.imagePath ? preview : null;
}

/** The player's address, from YouTube's privacy-enhanced host. Only ever built from a checked id. */
export function youtubeEmbedUrl(id: string, autoplay = true): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&rel=0&playsinline=1`;
}

/**
 * The store app's player: the club's page that frames the one above, since
 * YouTube refuses capacitor://localhost. A fragment lets videos reuse the same page.
 */
export function appYoutubeEmbedUrl(id: string): string {
  return `${SITE_ORIGIN}/embed/youtube.html#v=${id}`;
}

/** "reeve.org", for the card's small line when the page names no site. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}
