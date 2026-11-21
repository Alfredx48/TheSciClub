import { AtSign, Bell, BellOff } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SheetGrip } from '@/components/sheet-grip';
import { useAccount } from '@/lib/account';
import { type MuteTarget, type ThreadNotify, useMute, useThreadNotify } from '@/lib/chat/mutes';
import { useDialogFocus } from '@/lib/dialog-focus';
import { cn } from '@/lib/utils';

/**
 * Mute notifications from a conversation, a topic or a room.
 *
 * Built on `FollowButton`'s pattern, which the accessibility notes name as the
 * model toggle: `aria-pressed` for the state, and an `aria-label` that says
 * what pressing will do, because the visible word is the state. Sized in `em`
 * off its own letters so it grows with the text-size setting.
 *
 * Draws nothing until it knows the state, and nothing at all while the club
 * cannot send notifications — `useMute` never reads in that case, so `muted`
 * stays null. A mute button with nothing to mute is a control that does
 * nothing.
 *
 * `what` finishes the sentence a screen reader hears: "Mute notifications from
 * this conversation".
 */
export function MuteButton({
  target,
  what,
  className,
}: {
  target: MuteTarget;
  what: string;
  className?: string;
}) {
  const { userId } = useAccount();
  const { muted, busy, error, toggle } = useMute(target, userId);
  if (muted === null) return null;

  const Icon = muted ? BellOff : Bell;
  return (
    <span className={cn('inline-flex flex-col items-end', className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={muted}
        aria-label={
          muted
            ? `Notifications from ${what} are muted. Press to unmute.`
            : `Mute notifications from ${what}`
        }
        data-target="small"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-[0.85em] py-[0.45em] font-bold font-head text-[0.75rem] leading-[1.3] transition-colors disabled:opacity-50',
          muted
            ? 'bg-tint text-emphasis hover:bg-line'
            : 'border border-line text-emphasis hover:bg-tint',
        )}
      >
        <Icon aria-hidden="true" className="h-[1.1em] w-[1.1em] flex-none" />
        {muted ? 'Muted' : 'Mute'}
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-[0.75rem] text-destructive leading-[1.4]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

const NOTIFY_CHOICES: { value: ThreadNotify; title: string; says: string }[] = [
  { value: 'all', title: 'All messages', says: 'Every new message notifies you.' },
  {
    value: 'mentions',
    title: 'Only mentions',
    says: 'Only a message that @mentions you, or one marked Important.',
  },
  {
    value: 'off',
    title: 'None',
    says: 'No notifications from this conversation, except a message marked Important. Its messages still wait here.',
  },
];

/**
 * A conversation's notifications (20261113150000): All messages, Only mentions
 * (groups), or None. The pill says which; pressing it opens a sheet with the
 * three as cards, as Me's "How much should the club notify you?" is (the
 * owner, 2026-11-20). Draws nothing until it knows, nor while the club cannot
 * notify.
 */
export function ThreadNotifyButton({
  threadId,
  group,
  className,
}: {
  threadId: string;
  group: boolean;
  className?: string;
}) {
  const { userId } = useAccount();
  const { notify, busy, error, choose } = useThreadNotify(threadId, userId);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  if (notify === null) return null;

  // Only mentions means little in a conversation of two: every message there
  // is to you. Shown anyway if somebody chose it before.
  const choices = NOTIFY_CHOICES.filter(
    (c) => c.value !== 'mentions' || group || notify === 'mentions',
  );
  // A bell alone, like Search beside it (the owner, 2026-11-21); the choice is told by the
  // icon, and shaded when it is not All.
  const Icon = notify === 'off' ? BellOff : notify === 'mentions' ? AtSign : Bell;
  return (
    <span className={cn('inline-flex flex-col items-end', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Notifications from this conversation: ${
          NOTIFY_CHOICES.find((c) => c.value === notify)?.title ?? ''
        }. Change`}
        onClick={() => {
          setOpen(true);
        }}
        title={NOTIFY_CHOICES.find((c) => c.value === notify)?.title}
        className={cn(
          'flex h-[44px] w-[44px] items-center justify-center rounded-full transition-colors',
          notify === 'all' ? 'text-ink hover:bg-tint' : 'bg-tint text-emphasis hover:bg-line',
          busy ? 'opacity-50' : '',
        )}
      >
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </button>
      {error && !open ? (
        <span role="alert" className="mt-1 text-[0.75rem] text-destructive leading-[1.4]">
          {error}
        </span>
      ) : null}
      {open
        ? createPortal(
            <ThreadNotifySheet
              choices={choices}
              notify={notify}
              busy={busy}
              error={error}
              onChoose={choose}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </span>
  );
}

/** A bottom sheet on a phone and a centred panel on a desktop, as Display is. */
function ThreadNotifySheet({
  choices,
  notify,
  busy,
  error,
  onChoose,
  onClose,
}: {
  choices: typeof NOTIFY_CHOICES;
  notify: ThreadNotify;
  busy: boolean;
  error: string | null;
  onChoose: (next: ThreadNotify) => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(dialog, heading, onClose);

  return (
    <>
      <button
        type="button"
        aria-label="Close notification choices"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={cn(
          'fixed z-[81] flex flex-col bg-canvas',
          'inset-x-0 bottom-0 max-h-[88%] rounded-t-3xl shadow-[0_-14px_40px_rgba(10,20,35,.3)]',
          'lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:max-h-[82%] lg:w-[480px]',
          'lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl',
          'lg:shadow-[0_24px_60px_rgba(10,20,35,.35)]',
        )}
      >
        <SheetGrip sheet={dialog} onClose={onClose} />
        <div className="px-[18px] pt-1 lg:pt-5">
          <h2
            id={`${id}-title`}
            ref={heading}
            tabIndex={-1}
            className="font-extrabold font-head text-[1.3125rem] tracking-[-0.01em] outline-none"
          >
            Notifications
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-ink2">
            For this conversation, on all your devices.
          </p>
        </div>
        <fieldset className="mt-3 flex-1 overflow-y-auto px-[18px] pb-2">
          <legend className="sr-only">Notify me about</legend>
          <div className="flex flex-col gap-2">
            {choices.map((choice) => (
              <label
                key={choice.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[11px] border px-3 py-2.5',
                  notify === choice.value ? 'border-emphasis bg-tint' : 'border-line',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-notify`}
                  checked={notify === choice.value}
                  disabled={busy}
                  onChange={() => {
                    onChoose(choice.value);
                  }}
                  className="mt-0.5 h-5 w-5 flex-none accent-[var(--color-action)]"
                />
                <span className="min-w-0">
                  <span className="block font-bold text-[0.9375rem] text-ink">{choice.title}</span>
                  <span className="block text-[0.8125rem] text-ink2 leading-[1.4]">
                    {choice.says}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
        </fieldset>
        <div className="flex flex-none border-line border-t px-[18px] pt-3 pb-6 lg:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl bg-action px-5 font-bold font-head text-[0.9375rem] text-white transition-colors hover:bg-action-hi"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
