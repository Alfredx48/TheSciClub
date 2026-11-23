import { useRef, useState } from 'react';
import { PhotoViewer } from '@/components/photo-viewer';
import { useSmallCopies } from '@/lib/chat/attachments';

/**
 * The photographs on a message or a post, opened in PhotoViewer (src/components/photo-viewer.tsx).
 *
 * One photo at its own shape (max 20rem tall); two to four as squares. More than four (the owner,
 * 2026-11-22, who took the limit of four away): the first four tiles, the last saying how many more,
 * and the viewer steps through them all. The viewer shows the stored
 * 1,600px copy, enough to read a label or see a wound. Only Home passes `fill` (fixed-width cards);
 * a bubble fits what it holds. No tile background (owner, 2026-09-23): it letterboxed photos.
 *
 * Alt text is "Photograph N of M from <name>"; the message is the description, since nobody is
 * asked to describe a photo on the way in. A path the reader's token cannot sign (refused or
 * deleted) is not drawn, rather than a tile claiming a photo the reader cannot see.
 */
/** Tiles drawn at most; the rest are in the viewer. */
const TILES = 4;

export function AttachmentGrid({
  paths,
  from,
  fill = false,
  onOpen,
  openLabel,
  eager,
}: {
  paths: readonly string[];
  from: string;
  /** A single photograph fills the width, cropped. Home's cards only. */
  fill?: boolean;
  /** Home opens the containing topic; Chat keeps the full-picture viewer. */
  onOpen?: (() => void) | undefined;
  openLabel?: string | undefined;
  /**
   * Home's cards (the owner, 2026-11-22: "I don't like that they lazy load in"): loaded at once
   * rather than as they near the screen, the first cards' ahead of the rest.
   */
  eager?: 'first' | 'later' | undefined;
}) {
  // Tiles draw the small copy; the viewer opens the photograph.
  const { small, full } = useSmallCopies(paths);
  const [open, setOpen] = useState<number | null>(null);
  // The opening tile, for focus on close. Held from the click, not `document.activeElement`:
  // Safari does not focus a clicked button.
  const opener = useRef<HTMLButtonElement | null>(null);
  const shown = paths.filter((path) => small.has(path));

  if (shown.length === 0) return null;
  const single = shown.length === 1;
  const filled = fill && single;
  const tiles = shown.slice(0, TILES);
  const more = shown.length - tiles.length;

  return (
    <>
      <div className={`mt-2 grid gap-1.5 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {tiles.map((path, index) => (
          <button
            key={path}
            type="button"
            onClick={(event) => {
              if (onOpen) {
                onOpen();
                return;
              }
              opener.current = event.currentTarget;
              setOpen(index);
            }}
            aria-label={`Photograph ${index + 1} of ${shown.length} from ${from}${
              more > 0 && index === tiles.length - 1 ? `, and ${more} more` : ''
            }. ${openLabel ?? 'Open it.'}`}
            className={`${more > 0 && index === tiles.length - 1 ? 'relative ' : ''}block overflow-hidden rounded-[10px] ${
              filled ? 'aspect-[400/260] w-full' : single ? 'w-fit max-w-full' : 'aspect-square'
            }`}
          >
            <img
              src={small.get(path)}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager === 'first' ? 'high' : eager === 'later' ? 'low' : undefined}
              className={
                single && !filled
                  ? 'block h-auto max-h-[20rem] w-auto max-w-full'
                  : 'block h-full w-full object-cover'
              }
            />
            {more > 0 && index === tiles.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center bg-black/70 font-bold font-head text-[2rem] text-white"
              >
                +{more}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {open !== null && shown[open] ? (
        <PhotoViewer
          url={full.get(shown[open]) ?? small.get(shown[open]) ?? ''}
          label={`Photograph ${open + 1} of ${shown.length} from ${from}`}
          title={`Photographs from ${from}`}
          index={open}
          count={shown.length}
          onStep={(to) => {
            setOpen(to);
          }}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
