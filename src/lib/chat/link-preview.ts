import type { LinkPreview, LinkVideo } from '@/lib/chat/types';
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
  const youtubeId = checkedVideo(text('youtubeId'));
  const preview: LinkPreview = {
    url,
    title: text('title'),
    description: text('description'),
    siteName: text('siteName'),
    imagePath: checkedPicture(text('imagePath')),
    youtubeId,
  };
  const videos = youtubeId ? toVideos(row.videos) : [];
  if (videos.length > 0) preview.videos = videos;
  return preview.title || preview.imagePath ? preview : null;
}

const checkedPicture = (path: string | null) =>
  path && /^[0-9a-f]{64}\.(jpg|png|webp|gif)$/.test(path) ? path : null;
const checkedVideo = (id: string | null) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);

/** The other videos, each taken only if it is whole; three at most. */
function toVideos(raw: unknown): LinkVideo[] {
  if (!Array.isArray(raw)) return [];
  const videos: LinkVideo[] = [];
  for (const item of raw.slice(0, 3)) {
    if (typeof item !== 'object' || item === null) continue;
    const video = item as Record<string, unknown>;
    const text = (key: string) => {
      const value = video[key];
      return typeof value === 'string' && value.trim() !== '' ? value : null;
    };
    const url = text('url');
    const youtubeId = checkedVideo(text('youtubeId'));
    if (!url || !/^https?:\/\//i.test(url) || !youtubeId) continue;
    videos.push({
      url,
      title: text('title'),
      imagePath: checkedPicture(text('imagePath')),
      youtubeId,
    });
  }
  return videos;
}

/** The player's address, from YouTube's privacy-enhanced host. Only ever built from a checked id. */
export function youtubeEmbedUrl(id: string, muted = false): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${muted ? '&mute=1' : ''}`;
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
