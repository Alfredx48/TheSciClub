import { Plus, SmilePlus, X } from 'lucide-react';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LevelHighlight } from '@/components/injury-stage-pill';
import { MemberAvatar } from '@/components/member-avatar';
import { SheetGrip } from '@/components/sheet-grip';
import { WheelBadge } from '@/components/wheel-badge';
import { useChatAuthors } from '@/lib/chat/authors';
import {
  isReactionEmoji,
  REACTIONS,
  type ReactionEmoji,
  type ReactionRow,
  type ReactionsState,
  reactionName,
} from '@/lib/chat/reactions';
import { useDialogFocus } from '@/lib/dialog-focus';
import { EmojiGrid } from '@/routes/chat/emoji-grid';
import { ItemActions } from '@/routes/chat/item-actions';

/** Visible, generously sized controls: no long press or hover required to
 * react. Holding a reaction (or right-click, or the menu key) only adds a way
 * to see who reacted, which the React picker also shows.
 * Home's stretched topic links sit below these positioned buttons. */
export interface ReactionBarProps {
  target: string;
  /** The words being reacted to (or a description, e.g. "this photograph"). */
  what: string;
  /**
   * Whether `what` is the item's own words, quoted back in the picker. False
   * for a description such as "this photograph", which is not a quotation.
   */
  quoted?: boolean;
  state: ReactionsState;
  readerId: string | null;
  compact?: boolean;
  attached?: boolean;
  bubble?: ReactNode;
  align?: 'start' | 'end';
  actions?: ReactNode;
  /** The actions sheet's title: "Post actions" under a post. */
  actionsTitle?: string;
  reply?: ReactNode;
  /** Share, after Reply (share-post.tsx). */
  share?: ReactNode;
}
export function ReactionBar({
  target,
  what: words,
  quoted = true,
  state,
  readerId,
  compact = false,
  attached = false,
  bubble,
  align = 'start',
  actions,
  actionsTitle,
  reply,
  share,
}: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  // The emoji whose chip was held: the names sheet opens with it first.
  const [namesFor, setNamesFor] = useState<ReactionEmoji | null>(null);
  // Where the count was, for a computer's panel.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Short, so a long message is not printed again in the picker or read out
  // whole in every button's name (the owner, 2026-10-10).
  const what = quoted ? `“${excerpt(words)}”` : excerpt(words);
  const rows = state.rows.filter((r) => r.target_id === target && r.emoji !== null);
  const mine = rows.find((r) => r.member_id === readerId)?.emoji ?? null;
  const pending = state.pending.has(target);
  // Until read, the reader's own reaction is unknown: the picker waits, React does not.
  const known = !state.unread?.has(target);
  // Not while counts load: a slow read must not grey out React.
  const disabled = !readerId || pending;
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`React to ${what}`}
      onClick={() => {
        setOpen(true);
      }}
      className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.6875rem] text-grey hover:bg-tint disabled:opacity-50"
    >
      <SmilePlus aria-hidden="true" className="h-3 w-3" />
      {pending ? 'Saving…' : 'React'}
    </button>
  );
  async function choose(emoji: ReactionEmoji) {
    const saved = await state.choose(target, mine === emoji ? null : emoji);
    if (saved) setOpen(false);
    return saved;
  }
  const mouse = pointerIsMouse();
  const counts =
    !state.error &&
    emojiIn(rows).map(({ emoji, name }) => {
      const count = rows.filter((r) => r.emoji === emoji).length;
      return count ? (
        <ReactionChip
          key={emoji}
          emoji={emoji}
          label={`${name}: ${count} ${count === 1 ? 'reaction' : 'reactions'} on ${what}${mouse || mine === emoji ? '. Show who reacted' : '. React. Hold to see who reacted'}`}
          count={count}
          mine={mine === emoji}
          attached={attached}
          disabled={disabled}
          onTap={(rect) => {
            // With a mouse, a click shows who reacted, as WhatsApp's does; so
            // does a tap on your own, where you take it back (the owner, 2026-11-17).
            if (mouse || mine === emoji) {
              setAnchor(rect);
              setNamesFor(emoji);
            } else void choose(emoji);
          }}
          onHold={(rect) => {
            setAnchor(rect);
            setNamesFor(emoji);
          }}
        />
      ) : null;
    });
  const hasCounts = !state.error && rows.length > 0;
  return (
    <div
      className={`${bubble ? `flex min-w-0 max-w-full flex-col ${align === 'end' ? 'items-end' : 'items-start'}` : 'mt-2'} text-[0.8125rem] text-ink`}
    >
      {bubble ? (
        <div className="w-fit max-w-full">
          {bubble}
          {hasCounts ? (
            // Chip widths must not widen a short bubble; wrap within its width.
            <div className="relative -mt-2 flex w-0 min-w-full flex-wrap gap-1.5">{counts}</div>
          ) : null}
        </div>
      ) : null}
      <div className={`${bubble ? 'mt-1' : ''} flex flex-wrap items-center gap-1.5`}>
        {bubble ? null : counts}
        {trigger}
        {reply}
        {share}
        {compact ? (
          <ItemActions what={words} title={actionsTitle}>
            {actions}
          </ItemActions>
        ) : null}
      </div>
      {state.error ? (
        <p className="relative text-grey">
          {state.error}{' '}
          <button
            type="button"
            onClick={state.reload}
            className="min-h-11 px-2 font-semibold underline"
          >
            Retry reactions
          </button>
        </p>
      ) : null}
      {state.failure?.target === target ? (
        <p role="alert" className="relative text-destructive">
          {state.failure.message}
        </p>
      ) : null}
      {open
        ? createPortal(
            <ReactionSheet
              rows={rows}
              mine={mine}
              what={what}
              pending={pending}
              known={known}
              failure={state.failure?.target === target ? state.failure.message : null}
              choose={choose}
              onClose={() => {
                setOpen(false);
              }}
            />,
            document.body,
          )
        : null}
      {namesFor
        ? createPortal(
            <WhoReactedSheet
              rows={rows}
              first={namesFor}
              what={what}
              readerId={readerId}
              canReact={!disabled && known}
              anchor={anchor}
              onAdd={() => {
                setNamesFor(null);
                setOpen(true);
              }}
              onRemove={() => {
                void state.choose(target, null).then((saved) => {
                  if (saved) setNamesFor(null);
                });
              }}
              onClose={() => {
                setNamesFor(null);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

/** How long a press is held before it shows who reacted instead of reacting. */
export const HOLD_MS = 500;
/** A finger that moves further than this is scrolling, not holding. */
const HOLD_SLOP = 10;

/**
 * One emoji's count. A tap reacts (or takes yours back); holding it, a
 * right-click, or the keyboard's menu key shows who reacted, for anybody who
 * can read the item, whether or not they may react. So the button is never
 * `disabled` (a disabled button gets no pointer events and could not be
 * held); while reacting is unavailable it is `aria-disabled` and a tap does
 * nothing.
 */
function ReactionChip({
  emoji,
  label,
  count,
  mine,
  attached,
  disabled,
  onTap,
  onHold,
}: {
  emoji: ReactionEmoji;
  label: string;
  count: number;
  mine: boolean;
  attached: boolean;
  disabled: boolean;
  onTap: (rect: DOMRect) => void;
  onHold: (rect: DOMRect) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const rect = () => button.current?.getBoundingClientRect() ?? new DOMRect();
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Set when a hold opened the names, so the click that ends it does not react.
  const held = useRef(false);
  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  // A chip that goes away mid-hold (the count fell to zero) leaves no timer behind.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  function hold() {
    cancel();
    held.current = true;
    onHold(rect());
  }
  return (
    <button
      ref={button}
      type="button"
      aria-pressed={mine}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onPointerDown={(event: PointerEvent) => {
        if (event.button > 0) return;
        held.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        cancel();
        timer.current = window.setTimeout(hold, HOLD_MS);
      }}
      onPointerMove={(event: PointerEvent) => {
        const from = start.current;
        if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > HOLD_SLOP)
          cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        // Right-click, the menu key, and Android's long press.
        event.preventDefault();
        hold();
      }}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        if (pointerIsMouse() || !disabled) onTap(rect());
      }}
      className={`relative inline-flex min-h-11 min-w-11 select-none ${attached ? 'items-start' : 'items-center'} justify-center rounded-full font-semibold [-webkit-touch-callout:none] aria-disabled:opacity-50`}
    >
      <span
        className={`inline-flex items-center justify-center gap-1 rounded-full border ${attached ? 'min-h-7 px-2 text-[0.6875rem] shadow-sm' : 'min-h-11 px-3'} ${mine ? 'border-emphasis bg-tint text-emphasis' : 'border-line bg-paper'}`}
      >
        <span aria-hidden="true" className={attached ? 'text-sm' : 'text-lg'}>
          {emoji}
        </span>
        {count}
      </span>
    </button>
  );
}

/** Everybody who reacted, by emoji, with `first` at the top when given. */
function WhoReactedList({
  rows,
  first = null,
}: {
  rows: readonly ReactionRow[];
  first?: ReactionEmoji | null;
}) {
  const authors = useChatAuthors(rows.map((r) => r.member_id));
  const order = emojiIn(rows, first);
  return (
    <section className="mt-4 space-y-2" aria-label="Who reacted">
      {order.map(({ emoji, name }) => {
        const people = rows.filter((r) => r.emoji === emoji);
        return people.length ? (
          <p key={emoji} className="text-sm">
            <span aria-hidden="true">{emoji} </span>
            <span className="font-semibold">
              {name} ({people.length}):{' '}
            </span>
            {people.map((r) => authors.get(r.member_id)?.displayName ?? '…').join(', ')}
          </p>
        ) : null;
      })}
    </section>
  );
}

/**
 * The emoji reacted with, each once: `first` (the one held), then the eight in
 * their order, then any others from the + as they first appear.
 */
function emojiIn(
  rows: readonly ReactionRow[],
  first: ReactionEmoji | null = null,
): { emoji: ReactionEmoji; name: string }[] {
  const present = new Set(rows.flatMap((r) => (r.emoji ? [r.emoji] : [])));
  const known: string[] = REACTIONS.map((r) => r.emoji);
  const all = [
    ...known.filter((e) => present.has(e)),
    ...[...present].filter((e) => !known.includes(e)),
  ];
  const sorted = first && present.has(first) ? [first, ...all.filter((e) => e !== first)] : all;
  return sorted.map((emoji) => ({ emoji, name: reactionName(emoji) }));
}

/** A mouse rather than a finger: a click on a count shows who reacted. */
export function pointerIsMouse(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

const PANEL_WIDTH = 360;
const PANEL_GAP = 8;

/**
 * Who reacted, laid out as WhatsApp's (the owner, 2026-11-14): a count, a tab
 * per emoji, then a row per person with their emoji on the right; yours is
 * first and taking it back is a tap. A bottom sheet on a phone; beside the
 * count it came from, as a small panel, on a computer.
 */
function WhoReactedSheet({
  rows,
  first,
  what,
  readerId,
  canReact,
  anchor,
  onAdd,
  onRemove,
  onClose,
}: {
  rows: readonly ReactionRow[];
  first: ReactionEmoji;
  what: string;
  readerId: string | null;
  canReact: boolean;
  anchor: DOMRect | null;
  onAdd: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useDialogFocus(dialog, heading, onClose);
  // An emoji, or 'all' (no emoji is spelt that way).
  const [tab, setTab] = useState<ReactionEmoji>('all');
  const authors = useChatAuthors(rows.map((r) => r.member_id));
  const used = emojiIn(rows, first);
  const order = (r: ReactionRow) =>
    r.member_id === readerId ? -1 : used.findIndex((u) => u.emoji === r.emoji);
  const people = rows
    .filter((r) => tab === 'all' || r.emoji === tab)
    .sort((a, b) => order(a) - order(b));
  // A computer's panel sits by the count, below it or above when there is no room.
  const style =
    anchor && pointerIsMouse()
      ? {
          left: Math.max(16, Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - 16)),
          ...(window.innerHeight - anchor.bottom > 380
            ? { top: anchor.bottom + PANEL_GAP }
            : { bottom: window.innerHeight - anchor.top + PANEL_GAP }),
        }
      : null;
  const pill = (selected: boolean) =>
    `inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-semibold ${selected ? 'border-emphasis bg-tint text-emphasis' : 'border-line text-ink hover:bg-tint'}`;
  const count = rows.length;
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close who reacted"
        onClick={onClose}
        className={`fixed inset-0 z-[80] cursor-default ${style ? 'bg-transparent' : 'bg-black/40'}`}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Who reacted to ${what}`}
        style={style ?? undefined}
        className={
          style
            ? 'fixed z-[81] flex max-h-[360px] w-[360px] flex-col rounded-2xl border border-line bg-paper text-ink shadow-[0_18px_48px_rgba(10,20,35,.28)]'
            : 'fixed inset-x-0 bottom-0 z-[81] flex max-h-[75dvh] flex-col rounded-t-3xl bg-paper pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-xl'
        }
      >
        {style ? null : <SheetGrip sheet={dialog} onClose={onClose} />}
        <div className={`flex items-center gap-2 px-5 ${style ? 'pt-3' : ''}`}>
          <h2
            ref={heading}
            tabIndex={-1}
            className="min-w-0 flex-1 font-extrabold font-head text-[1.1875rem] outline-none"
          >
            {count} {count === 1 ? 'Reaction' : 'Reactions'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-grey hover:bg-tint"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-none gap-2 overflow-x-auto px-5 pt-2 pb-3">
          {canReact ? (
            <button
              type="button"
              aria-label="Add a reaction"
              onClick={onAdd}
              className={pill(false)}
            >
              <SmilePlus aria-hidden="true" className="h-5 w-5 text-grey" />
            </button>
          ) : null}
          {used.length > 1 ? (
            <button
              type="button"
              aria-pressed={tab === 'all'}
              onClick={() => {
                setTab('all');
              }}
              className={pill(tab === 'all')}
            >
              All {count}
            </button>
          ) : null}
          {used.map(({ emoji, name }) => {
            const n = rows.filter((r) => r.emoji === emoji).length;
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={used.length === 1 || tab === emoji}
                aria-label={`${name} ${n}`}
                onClick={() => {
                  setTab(emoji);
                }}
                className={pill(used.length > 1 && tab === emoji)}
              >
                <span aria-hidden="true" className="text-xl">
                  {emoji}
                </span>
                <span aria-hidden="true">{n}</span>
              </button>
            );
          })}
        </div>
        <ul aria-label="Who reacted" className="min-h-0 flex-1 overflow-y-auto pb-2">
          {people.map((r) => {
            const author = authors.get(r.member_id);
            const name = author?.displayName ?? '…';
            const yours = r.member_id === readerId;
            const face = (
              <span aria-hidden="true" className="flex-none">
                <MemberAvatar
                  id={r.member_id}
                  displayName={name}
                  photoPath={author?.photoPath}
                  photoAlt={author?.photoAlt}
                  className="h-11 w-11 rounded-full"
                />
              </span>
            );
            const emoji = (
              <span aria-hidden="true" className="flex-none text-2xl">
                {r.emoji}
              </span>
            );
            return (
              <li key={r.member_id}>
                {yours && canReact ? (
                  <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`You reacted ${r.emoji}. ${style ? 'Click' : 'Tap'} to remove`}
                    className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-left hover:bg-tint"
                  >
                    {face}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[1rem]">You</span>
                      <span className="block text-[0.8125rem] text-grey">
                        {style ? 'Click' : 'Tap'} to remove
                      </span>
                    </span>
                    {emoji}
                  </button>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 px-5 py-2">
                    {face}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-[1rem]">
                        {yours ? 'You' : name}
                      </span>
                      {!yours && author?.level ? (
                        <span className="block truncate text-[0.8125rem] text-grey">
                          <LevelHighlight
                            level={author.level}
                            stage={author.stage}
                            band={author.band}
                            injuryType={author.injuryType}
                          />
                          <WheelBadge memberId={author.id} still className="ml-1.5" />
                        </span>
                      ) : null}
                    </span>
                    <span className="sr-only">reacted {r.emoji}</span>
                    {emoji}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function ReactionSheet({
  rows,
  mine,
  what,
  pending,
  known = true,
  failure,
  choose,
  onClose,
}: {
  rows: readonly ReactionRow[];
  mine: ReactionEmoji | null;
  what: string;
  pending: boolean;
  known?: boolean;
  failure: string | null;
  choose: (emoji: ReactionEmoji) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  useDialogFocus(dialog, heading, onClose);
  // The + (2026-11-14): every emoji, as WhatsApp's + opens.
  const [browsing, setBrowsing] = useState(false);
  // The owner, 2026-10-10: a picker that is the emoji and little else. A
  // choice is saved and the picker closes as soon as it is tapped (it stays
  // open only when saving fails, to try again). No Done button; a small Close,
  // the backdrop and Escape remain, because somebody on a keyboard or a
  // switch needs a control to leave by, and the backdrop is not one.
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close reactions"
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-black/40"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`React to ${what}`}
        className="fixed inset-x-0 bottom-0 z-[81] max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-paper px-5 pt-4 pb-6 text-ink shadow-xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <p
            ref={heading}
            tabIndex={-1}
            className="min-w-0 flex-1 pt-2.5 text-[0.875rem] text-grey leading-snug outline-none [overflow-wrap:anywhere]"
          >
            {what}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-grey hover:bg-tint"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {[
            ...REACTIONS,
            ...(mine && !REACTIONS.some((r) => r.emoji === mine)
              ? [{ emoji: mine, name: mine }]
              : []),
          ].map(({ emoji, name }) => (
            <button
              key={emoji}
              type="button"
              aria-label={name}
              aria-pressed={mine === emoji}
              disabled={pending || !known}
              onClick={() => {
                void choose(emoji);
              }}
              className={`min-h-12 rounded-xl border text-2xl disabled:opacity-50 ${mine === emoji ? 'border-emphasis bg-tint' : 'border-line hover:bg-tint'}`}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
          <button
            type="button"
            aria-label="Every emoji"
            aria-expanded={browsing}
            disabled={pending || !known}
            onClick={() => {
              setBrowsing((open) => !open);
            }}
            className={`grid min-h-12 place-items-center rounded-xl border text-grey disabled:opacity-50 ${browsing ? 'border-emphasis bg-tint' : 'border-line hover:bg-tint'}`}
          >
            <Plus aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>
        {browsing ? (
          <EmojiGrid
            onPick={(emoji) => {
              if (isReactionEmoji(emoji) && !pending) void choose(emoji);
            }}
          />
        ) : null}
        {known ? null : (
          <p role="status" className="mt-2 text-[0.75rem] text-grey">
            Loading your reaction…
          </p>
        )}
        {mine ? (
          <p className="mt-2 text-[0.75rem] text-grey">Tap {mine} again to take it back.</p>
        ) : null}
        {failure ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {failure}
          </p>
        ) : null}
        {rows.length && !browsing ? <WhoReactedList rows={rows} /> : null}
      </div>
    </>
  );
}

/** How much of what is being reacted to is quoted back. */
export const EXCERPT_LENGTH = 80;

/**
 * The first 80 characters, on one line, cut at a word with an ellipsis when
 * there is more. Counted in code points, so an emoji is not cut in half.
 */
export function excerpt(text: string, max = EXCERPT_LENGTH): string {
  const flat = Array.from(text.replace(/\s+/g, ' ').trim());
  if (flat.length <= max) return flat.join('');
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max / 2 ? cut.slice(0, space) : cut;
  return `${kept.join('').trimEnd()}…`;
}
