import { Play } from 'lucide-react';
import { useState } from 'react';
import { useAttachmentUrls } from '@/lib/chat/attachments';
import { appYoutubeEmbedUrl, siteOf, youtubeEmbedUrl } from '@/lib/chat/link-preview';
import type { LinkPreview } from '@/lib/chat/types';
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
 * stays until the player loads, then YouTube's own Play button takes over.
 * The store app plays it in place
 * too, through the club's player page (YouTube refuses capacitor://localhost),
 * with an "Open in YouTube" link under it. Everything else, Instagram included
 * at the owner's choice, opens its page in a new tab the way the link in the
 * words does.
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
  const [playing, setPlaying] = useState(false);
  const [loadedVideo, setLoadedVideo] = useState<string>();
  // A picture too small to be a banner (Instagram offers a 100px profile
  // picture) is drawn as a thumbnail beside the words instead of blown up.
  // Known only once it has loaded, so the card starts as a banner and may
  // become a row; a held conversation keeps its place through that.
  const [small, setSmall] = useState(false);
  const urls = useAttachmentUrls(preview.imagePath ? [preview.imagePath] : [], 'link-previews');
  const picture = preview.imagePath ? (urls.get(preview.imagePath) ?? null) : null;
  const site = preview.siteName ?? siteOf(preview.url);
  const title = preview.title ?? site;
  const video = preview.youtubeId;
  const native = !!video && isNative();
  const waitForPlayer = !!video && !native && isStandalone();
  const loadingPlayer = waitForPlayer && loadedVideo !== video;

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

  const image = preview.imagePath ? (
    <span
      className={cn(
        'block bg-tint',
        small && !video
          ? 'm-3 mr-0 h-[4.5rem] w-[4.5rem] flex-none overflow-hidden rounded-[9px]'
          : cn('w-full', video ? 'aspect-video' : 'aspect-[1.91/1]'),
      )}
    >
      {picture ? (
        <img
          src={picture}
          alt=""
          loading="lazy"
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth < SMALL_PICTURE) setSmall(true);
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
      {video ? (
        <>
          <div className="relative aspect-video w-full bg-black">
            {!playing || loadingPlayer
              ? (image ?? <span className="block h-full bg-tint" />)
              : null}
            {playing ? (
              <iframe
                key={video}
                src={native ? appYoutubeEmbedUrl(video) : youtubeEmbedUrl(video, !waitForPlayer)}
                title={`YouTube video: ${title}`}
                className={cn(
                  'absolute inset-0 block h-full w-full bg-black [color-scheme:light]',
                  loadingPlayer && 'invisible',
                )}
                aria-hidden={loadingPlayer || undefined}
                onLoad={
                  waitForPlayer
                    ? () => {
                        setLoadedVideo(video);
                      }
                    : undefined
                }
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
                aria-label={`Play video: ${title}`}
                className="absolute inset-0 grid w-full place-items-center"
              >
                <span className="grid h-14 w-14 place-items-center rounded-full bg-black/70 text-white">
                  <Play className="ml-0.5 h-7 w-7" fill="currentColor" aria-hidden="true" />
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
                  className="size-6 rounded-full border-2 border-white border-b-transparent drop-shadow-[0_0_2px_#000] motion-safe:animate-spin"
                />
                <span className="sr-only">Loading video…</span>
              </span>
            ) : null}
          </div>
          {playing && native ? (
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex min-h-[44px] items-center px-3 font-semibold text-[0.875rem] text-emphasis underline underline-offset-2"
            >
              Open in YouTube
              <span className="sr-only"> (opens in the in-app browser)</span>
            </a>
          ) : null}
        </>
      ) : null}
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        title={preview.url}
        className={cn('block hover:bg-tint', small && !video && 'flex items-start')}
      >
        {video ? null : image}
        {words}
      </a>
    </div>
  );
}
