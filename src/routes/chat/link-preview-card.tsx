import { Play } from 'lucide-react';
import { useState } from 'react';
import { useAttachmentUrls } from '@/lib/chat/attachments';
import { appYoutubeEmbedUrl, siteOf, youtubeEmbedUrl } from '@/lib/chat/link-preview';
import type { LinkPreview, LinkVideo } from '@/lib/chat/types';
import { debugMediaLoaded, debugMediaShown } from '@/lib/debug-log';
import { isNative, isStandalone } from '@/lib/standalone';
import { cn } from '@/lib/utils';

/**
 * The card under a link: its page's picture and title (the owner,
 * 2026-10-06), in a conversation, a room and on Home.
 *
 * Everything on it was read by the club when the words were written
 * (20261006010000), and the picture is the club's own copy, signed like a
 * photograph in Chat. So drawing the card tells the linked site nothing.
 *
 * A YouTube video plays where it is, on a press and not before: the button
 * swaps the picture for YouTube's privacy-enhanced player, which is the
 * first moment anything reaches YouTube. On the Home Screen the thumbnail
 * stays until the player loads and requests muted playback.
 * The store app plays it in place
 * too, through the club's player page (YouTube refuses capacitor://localhost),
 * with an "Open in YouTube" link under it. Everything else, Instagram included
 * at the owner's choice, opens its page in a new tab the way the link in the
 * words does.
 *
 * Several videos in the same words (the owner, 2026-11-25) are tiles two
 * across, as photographs are (attachment-grid.tsx); the one pressed spans
 * both columns and plays there.
 *
 * The picture's box has its shape before the picture arrives, so a card
 * filling in does not push the conversation about (see lib/hold-scroll.ts).
 * The picture itself says nothing the title does not, so it is decorative to
 * a screen reader; the link's name is the title and the site.
 */
/** Narrower than this, a picture is a thumbnail rather than a banner. */
const SMALL_PICTURE = 320;

export function LinkPreviewCard({
  preview,
  className,
}: {
  preview: LinkPreview;
  /** `relative` on Home, where the card's own link is stretched over it. */
  className?: string;
}) {
  // A picture too small to be a banner (Instagram offers a 100px profile
  // picture) is drawn as a thumbnail beside the words instead of blown up.
  // Known only once it has loaded, so the card starts as a banner and may
  // become a row; a held conversation keeps its place through that.
  const [small, setSmall] = useState(false);
  const videos: LinkVideo[] = preview.youtubeId
    ? [
        {
          url: preview.url,
          title: preview.title,
          imagePath: preview.imagePath,
          youtubeId: preview.youtubeId,
        },
        ...(preview.videos ?? []),
      ]
    : [];
  const paths = preview.youtubeId
    ? videos.flatMap((video) => (video.imagePath ? [video.imagePath] : []))
    : preview.imagePath
      ? [preview.imagePath]
      : [];
  const urls = useAttachmentUrls(paths, 'link-previews');
  const pictureOf = (path: string | null) => (path ? (urls.get(path) ?? null) : null);
  const site = preview.siteName ?? siteOf(preview.url);
  const title = preview.title ?? site;
  const video = preview.youtubeId;

  if (videos.length > 1) {
    return (
      <div className={cn('mt-2 grid w-full max-w-[420px] grid-cols-2 gap-1.5', className)}>
        {videos.map((each, index) => (
          <VideoPlayer
            key={each.youtubeId}
            video={each}
            picture={pictureOf(each.imagePath)}
            title={each.title ?? `${site} video ${index + 1}`}
            label={`Play video ${index + 1} of ${videos.length}: ${each.title ?? site}`}
            tile
          />
        ))}
      </div>
    );
  }

  const picture = pictureOf(preview.imagePath);

  const words = (
    <span className="block min-w-0 flex-1 px-3 py-2.5 [overflow-wrap:anywhere]">
      <span className="block font-semibold text-[0.71875rem] text-grey uppercase tracking-[0.06em] [overflow-wrap:anywhere]">
        {site}
      </span>
      <span className="mt-0.5 line-clamp-3 block font-bold font-head text-[0.875rem] text-ink leading-[1.35]">
        {title}
      </span>
      {preview.description && !video ? (
        <span className="mt-1 line-clamp-2 block text-[0.78125rem] text-ink2 leading-[1.45]">
          {preview.description}
        </span>
      ) : null}
    </span>
  );

  const image =
    preview.imagePath && !video ? (
      <span
        className={cn(
          'block bg-tint',
          small
            ? 'm-3 mr-0 h-[4.5rem] w-[4.5rem] flex-none overflow-hidden rounded-[9px]'
            : 'aspect-[1.91/1] w-full',
        )}
      >
        {picture ? (
          <img
            src={picture}
            alt=""
            loading="lazy"
            ref={debugMediaShown}
            onLoad={(event) => {
              debugMediaLoaded('link picture', site, event.currentTarget, true);
              if (event.currentTarget.naturalWidth < SMALL_PICTURE) setSmall(true);
            }}
            onError={(event) => {
              debugMediaLoaded('link picture', site, event.currentTarget, false);
            }}
            className="h-full w-full object-cover"
          />
        ) : null}
      </span>
    ) : null;

  return (
    <div
      className={cn(
        'mt-2 w-full max-w-[420px] overflow-hidden rounded-[13px] border border-line bg-paper text-left',
        className,
      )}
    >
      {videos[0] ? (
        <VideoPlayer
          video={videos[0]}
          picture={picture}
          title={title}
          label={`Play video: ${title}`}
        />
      ) : null}
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        title={preview.url}
        className={cn('block hover:bg-tint', small && !video && 'flex items-start')}
      >
        {image}
        {words}
      </a>
    </div>
  );
}

/**
 * One video: its picture and a play button, then YouTube's player in its
 * place. A `tile` is a square in the grid of several, spanning both columns
 * once it plays.
 */
function VideoPlayer({
  video,
  picture,
  title,
  label,
  tile = false,
}: {
  video: LinkVideo;
  picture: string | null;
  title: string;
  label: string;
  tile?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const id = video.youtubeId;
  const native = isNative();
  const homeScreen = !native && isStandalone();
  const loadingPlayer = homeScreen && !loaded;

  return (
    <div className={cn(tile && 'overflow-hidden rounded-[10px]', tile && playing && 'col-span-2')}>
      <div
        className={cn(
          'relative w-full bg-black',
          tile && !playing ? 'aspect-square' : 'aspect-video',
        )}
      >
        {!playing || loadingPlayer ? (
          picture ? (
            <img
              src={picture}
              alt=""
              loading="lazy"
              ref={debugMediaShown}
              onLoad={(event) => {
                debugMediaLoaded('link picture', `YouTube ${id}`, event.currentTarget, true);
              }}
              onError={(event) => {
                debugMediaLoaded('link picture', `YouTube ${id}`, event.currentTarget, false);
              }}
              className="block h-full w-full object-cover"
            />
          ) : (
            <span className="block h-full bg-tint" />
          )
        ) : null}
        {playing ? (
          <iframe
            key={id}
            src={native ? appYoutubeEmbedUrl(id) : youtubeEmbedUrl(id, homeScreen)}
            title={`YouTube video: ${title}`}
            className={cn(
              'absolute inset-0 block h-full w-full bg-black [color-scheme:light]',
              loadingPlayer && 'invisible',
            )}
            aria-hidden={loadingPlayer || undefined}
            ref={debugMediaShown}
            onLoad={(event) => {
              debugMediaLoaded('video player', `YouTube ${id}`, event.currentTarget, true);
              if (homeScreen) setLoaded(true);
            }}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setPlaying(true);
            }}
            aria-label={label}
            className="absolute inset-0 grid w-full place-items-center"
          >
            <span
              className={cn(
                'grid place-items-center rounded-full bg-black/70 text-white',
                tile ? 'h-11 w-11' : 'h-14 w-14',
              )}
            >
              <Play
                className={cn('ml-0.5', tile ? 'h-5 w-5' : 'h-7 w-7')}
                fill="currentColor"
                aria-hidden="true"
              />
            </span>
          </button>
        )}
        {playing && loadingPlayer ? (
          <span
            role="status"
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <span
              aria-hidden="true"
              className="size-8 rounded-full border-2 border-white border-b-transparent drop-shadow-[0_0_2px_#000] motion-safe:animate-spin"
            />
            <span className="sr-only">Loading video…</span>
          </span>
        ) : null}
      </div>
      {playing && native ? (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className={cn(
            'flex min-h-[44px] items-center px-3 font-semibold text-[0.875rem] text-emphasis underline underline-offset-2',
            tile && 'bg-paper',
          )}
        >
          Open in YouTube
          <span className="sr-only"> (opens in the in-app browser)</span>
        </a>
      ) : null}
    </div>
  );
}
