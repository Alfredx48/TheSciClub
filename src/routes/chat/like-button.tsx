import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { type MouseEvent, type PointerEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { MemberAvatar } from '@/components/member-avatar';
import { SheetGrip } from '@/components/sheet-grip';
import { useChatAuthors } from '@/lib/chat/authors';
import type { PostVote, Vote } from '@/lib/chat/likes';
import { useDialogFocus } from '@/lib/dialog-focus';
import { cn } from '@/lib/utils';

/**
 * Votes on a post: the up arrow, the score, the down arrow (the owner, 2026-11-18, as Reddit), and
 * the list of who upvoted. One `PostLikes` for topics, rooms and Home, so they cannot drift.
 *
 * Each arrow is a toggle: `aria-pressed` carries the state and the name says the action and the
 * post, or a topic is a column of identical buttons to a screen reader. The score opens the list of
 * who upvoted (an upvote is a like, and likes were always named); downvotes are anonymous.
 *
 * A club administrator's long press on the up arrow, or right click, boosts the post. The
 * click that follows a long press is swallowed, so it does not also upvote. The list has the same
 * as buttons, with removing the boost, for a keyboard and a screen reader. Only an administrator
 * sees the boost: it lifts the post in the order and is in no score (20261118195000).
 *
 * The list is a dialog like report-sheet.tsx, `fixed` since it opens from inside a card. The
 * score is refocused by name on close: Safari does not focus a clicked button.
 */

/** Sized in em off its own letters, so it grows with the text-size setting. */
const CONTROL = 'inline-flex items-center gap-[0.35em] font-bold font-head leading-[1.3]';
/**
 * In the letters Like had, the row's own size and the count's grey (the owner, 2026-11-18: 15px
 * letters were "a bit too loud"). The padding, not the letters, makes each arrow a fair target.
 */
const PILL = 'inline-flex items-center rounded-full bg-tint';
const ARROW = 'inline-flex items-center justify-center rounded-full p-[0.5em] transition-colors';
/** The reader's own vote, on its arrow and the score: up in the club's colour, down in Mind's. */
const VOTED: Record<Vote, string> = {
  1: 'text-emphasis',
  [-1]: 'text-room-mind',
  0: 'text-ink2',
};

/** The score, with a true minus sign: a hyphen reads cramped beside the arrow. */
function scoreText(score: number): string {
  return score < 0 ? `−${String(-score)}` : String(score);
}
/** How long a press is a long press, in milliseconds. */
const LONG_PRESS = 550;

/** A long press (touch or pen) or right click, for an administrator's boost. */
function useBoostPress(onBoost: (() => void) | undefined) {
  const timer = useRef<number | null>(null);
  // When the last boost fired: the click after a long press, and the context menu a long press
  // also raises on Android, are not a second action.
  const fired = useRef(0);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const fire = () => {
    if (!onBoost || Date.now() - fired.current < 1000) return;
    fired.current = Date.now();
    onBoost();
  };
  return {
    /** True for the click that ends a long press. */
    swallow: () => Date.now() - fired.current < 1000,
    handlers: onBoost
      ? {
          onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
            if (e.pointerType === 'mouse') return;
            clear();
            timer.current = window.setTimeout(() => {
              timer.current = null;
              fire();
            }, LONG_PRESS);
          },
          onPointerUp: clear,
          onPointerLeave: clear,
          onPointerCancel: clear,
          onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            clear();
            fire();
          },
        }
      : {},
  };
}

type PostLikesProps = Omit<
  PostVote,
  'score' | 'myVote' | 'boost' | 'onDownvote' | 'failure' | 'readerId'
> & {
  readerId: string | null;
  /** The score; the upvotes where it is not known. */
  score?: number | undefined;
  myVote?: Vote | undefined;
  boost?: number | null | undefined;
  onDownvote?: (() => void) | undefined;
  /** Drawn by the screen, under its row of controls. */
  failure?: string | null | undefined;
  what: string;
  /** Handed to the profile links in the list, so Back returns here. */
  linkState?: unknown;
  className?: string | undefined;
};

export function PostLikes({
  likedBy,
  readerId,
  score: given,
  myVote: givenVote,
  boost = null,
  what,
  onToggle,
  onDownvote,
  onBoost,
  linkState,
  className,
  loading = false,
  unavailable = false,
}: PostLikesProps) {
  const [open, setOpen] = useState(false);
  const count = useRef<HTMLButtonElement | null>(null);
  const score = given ?? likedBy.length;
  const myVote: Vote = givenVote ?? (readerId && likedBy.includes(readerId) ? 1 : 0);
  // Goes up with each upvote, so the arrow remounts and pulses once.
  const [pulse, setPulse] = useState(0);
  const press = useBoostPress(
    onBoost
      ? () => {
          onBoost(true);
        }
      : undefined,
  );
  const unknown = loading || unavailable;
  const canOpen = !unknown && (likedBy.length > 0 || Boolean(onBoost));

  return (
    <span className={cn(CONTROL, className)}>
      <span className={PILL}>
        {readerId ? (
          <button
            type="button"
            disabled={unknown}
            {...press.handlers}
            onClick={() => {
              if (press.swallow()) return;
              if (myVote !== 1) setPulse((n) => n + 1);
              onToggle();
            }}
            aria-pressed={unknown ? undefined : myVote === 1}
            aria-label={
              unknown
                ? `Your vote on ${what} is not known`
                : myVote === 1
                  ? `Upvoted ${what}. Press to take it back.`
                  : `Upvote ${what}`
            }
            data-target="small"
            className={cn(
              ARROW,
              // A long press must not select the score or open iOS's callout.
              onBoost && 'touch-manipulation select-none [-webkit-touch-callout:none]',
              myVote === 1 && !unknown ? 'text-emphasis' : 'text-ink2 hover:text-emphasis',
            )}
          >
            <ArrowBigUp
              key={pulse}
              aria-hidden="true"
              className={cn(
                'h-[1.15em] w-[1.15em] flex-none',
                myVote === 1 && !unknown ? 'fill-current' : 'fill-none',
                unknown && 'opacity-40',
                pulse > 0 && 'like-pulse',
              )}
            />
          </button>
        ) : null}
        {unknown ? (
          <span className="px-[0.2em] font-semibold text-ink2">
            {loading ? '…' : 'Votes unavailable'}
          </span>
        ) : canOpen ? (
          <button
            ref={count}
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            aria-label={`Score ${score} on ${what}. Show who upvoted.`}
            data-target="small"
            className={cn(
              'min-w-[1.4em] px-[0.1em] text-center font-semibold underline-offset-2 hover:underline',
              VOTED[myVote],
            )}
          >
            {scoreText(score)}
          </button>
        ) : (
          <span className={cn('min-w-[1.4em] px-[0.1em] text-center font-semibold', VOTED[myVote])}>
            <span className="sr-only">Score </span>
            {scoreText(score)}
          </span>
        )}
        {readerId && onDownvote ? (
          <button
            type="button"
            disabled={unknown}
            onClick={onDownvote}
            aria-pressed={unknown ? undefined : myVote === -1}
            aria-label={
              unknown
                ? `Your vote on ${what} is not known`
                : myVote === -1
                  ? `Downvoted ${what}. Press to take it back.`
                  : `Downvote ${what}`
            }
            data-target="small"
            className={cn(
              ARROW,
              myVote === -1 && !unknown ? 'text-room-mind' : 'text-ink2 hover:text-room-mind',
            )}
          >
            <ArrowBigDown
              aria-hidden="true"
              className={cn(
                'h-[1.15em] w-[1.15em] flex-none',
                myVote === -1 && !unknown ? 'fill-current' : 'fill-none',
                unknown && 'opacity-40',
              )}
            />
          </button>
        ) : null}
      </span>
      {/* An administrator's alone: members never see the boost. */}
      {boost && !unknown ? <span className="font-semibold text-ink2">Boosted</span> : null}
      {open ? (
        <LikesSheet
          memberIds={likedBy}
          linkState={linkState}
          boost={boost}
          onBoost={onBoost}
          onClose={() => {
            setOpen(false);
            count.current?.focus();
          }}
        />
      ) : null}
    </span>
  );
}

export function LikesSheet({
  memberIds,
  linkState,
  boost = null,
  onBoost,
  onClose,
}: {
  memberIds: readonly string[];
  linkState?: unknown;
  /** An administrator's: whether the post is boosted (10 or 0), and boosting or taking it back. */
  boost?: number | null | undefined;
  onBoost?: ((more: boolean) => void) | undefined;
  onClose: () => void;
}) {
  const authors = useChatAuthors([...memberIds]);
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const title = 'Who upvoted this';
  const known = memberIds.flatMap((id) => {
    const author = authors.get(id);
    return author ? [author] : [];
  });

  useDialogFocus(dialog, heading, onClose);

  return (
    <>
      {/* Out of the Tab order, as the viewer's backdrop is: it is there for a
          pointer, and a keyboard already has Close and Escape. */}
      <button
        type="button"
        aria-label="Close the list"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-[70] cursor-default bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="likes-sheet-title"
        className={cn(
          'fixed z-[71] flex flex-col bg-paper',
          'inset-x-0 bottom-0 max-h-[80%] rounded-t-3xl shadow-[0_-14px_40px_rgba(10,20,35,.3)]',
          'lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:max-h-[70%] lg:w-[420px]',
          'lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl',
          'lg:shadow-[0_24px_60px_rgba(10,20,35,.35)]',
        )}
      >
        {/* A phone affordance; noise on a panel. */}
        <SheetGrip sheet={dialog} onClose={onClose} />

        <div className="flex-1 overflow-y-auto px-[18px] pt-1 lg:pt-5">
          <h2
            id="likes-sheet-title"
            ref={heading}
            tabIndex={-1}
            className="font-extrabold font-head text-[1.3125rem] text-ink tracking-[-0.01em] outline-none"
          >
            {title}
          </h2>
          <p className="mt-1 text-[0.84375rem] text-ink2 leading-[1.55]">
            Every member can see this list. Downvotes are anonymous.
          </p>

          {memberIds.length === 0 ? (
            <p className="py-4 text-[0.875rem] text-grey">Nobody has upvoted this yet.</p>
          ) : known.length === 0 ? (
            <p role="status" className="py-4 text-[0.875rem] text-grey">
              Loading…
            </p>
          ) : (
            <ul className="mt-3 mb-2">
              {known.map((author) => (
                <li key={author.id} className="flex items-center gap-3 border-line border-t py-2.5">
                  {/* Decorative: the link to the profile is on the name. */}
                  <span aria-hidden="true" className="flex-none">
                    <MemberAvatar
                      id={author.id}
                      displayName={author.displayName}
                      photoPath={author.photoPath}
                      photoAlt={author.photoAlt}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold font-head text-[0.90625rem] text-ink">
                      {author.hasProfile ? (
                        <Link
                          to={`/peers/${author.id}`}
                          state={linkState}
                          className="underline-offset-2 hover:underline"
                        >
                          {author.displayName}
                        </Link>
                      ) : (
                        // Named, not linked: /peers/:id will not show them.
                        author.displayName
                      )}
                    </span>
                    {author.level ? (
                      <span className="block text-[0.78125rem] text-grey">
                        <LevelHighlight
                          level={author.level}
                          stage={author.stage}
                          band={author.band}
                          injuryType={author.injuryType}
                        />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onBoost ? (
          <div className="flex-none border-line border-t px-[18px] py-3">
            <p className="font-bold text-[0.78125rem] text-grey">
              For administrators: {boost ? 'boosted' : 'not boosted'}
            </p>
            <p className="mt-0.5 text-[0.75rem] text-grey leading-[1.45]">
              A boost moves the post up in Top and on Home as a new reply would, and it sinks again
              as other posts get replies. Members don't see it, and it isn't in the score. A long
              press or right click on the up arrow boosts too.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onBoost(true);
                }}
                className="min-h-[44px] flex-1 rounded-xl bg-tint px-4 font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-line disabled:opacity-40"
              >
                {boost ? 'Boost again' : 'Boost'}
              </button>
              <button
                type="button"
                disabled={!boost}
                onClick={() => {
                  onBoost(false);
                }}
                className="min-h-[44px] flex-1 rounded-xl bg-tint px-4 font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-line disabled:opacity-40"
              >
                Remove boost
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-none border-line border-t px-[18px] pt-3 pb-6 lg:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl bg-tint px-5 font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-line"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
