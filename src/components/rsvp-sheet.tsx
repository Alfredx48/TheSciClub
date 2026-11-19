import { CalendarPlus, ExternalLink } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { SheetGrip } from '@/components/sheet-grip';
import { useAnnounce } from '@/lib/announce';
import { describeThrown } from '@/lib/describe-error';
import { useDialogFocus } from '@/lib/dialog-focus';
import { loadOwnPhone, saveOwnPhone } from '@/lib/event-phone';
import { rsvpSaved } from '@/lib/events';
import { useOrganizations } from '@/lib/organizations';
import { formatPhoneInput, isCompletePhone } from '@/lib/phone';
import { isNative } from '@/lib/standalone';
import { cn } from '@/lib/utils';
import {
  type CalendarEvent,
  downloadIcs,
  googleCalendarUrl,
} from '@/routes/events/add-to-calendar';
import { rsvpReachesHost } from '@/routes/events/format';
import { safeHref } from '@/routes/events/rich-text';
import type { ClubEvent, RsvpStatus } from '@/types/domain';

/**
 * The sheet that opens once Going or Interested is saved (the owner,
 * 2026-10-27): what the answer shares, a way to put the event in the member's
 * own calendar, and, for Going with no number on file, the phone number the
 * host may use.
 *
 * It replaced the line under every Going button. What Going shares is said
 * here instead, with Interested, which shares nothing, one press away. The
 * phone number stays optional: closing the sheet without one is a skip, and
 * holds for the rest of this browser session.
 */

/**
 * What Going shares (the owner, 2026-10-08, and 2026-10-10 once the email
 * address became the account). The Privacy Policy's "Event hosts" says the
 * same at length; keep the two in step.
 */
export const GOING_SHARES_CONTACT =
  'We share your email with the host, and your phone number if you’ve added one, for this event only.';

/** The event as the sheet needs it: for the calendar, and the host's own sign-up. */
export type SheetEvent = CalendarEvent &
  Pick<ClubEvent, 'registrationUrl' | 'handAdded' | 'organizationId' | 'hostName'>;

const SKIPPED_KEY = 'sciclub.goingPhoneSkipped';

function skippedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSkip(): void {
  try {
    window.sessionStorage.setItem(SKIPPED_KEY, '1');
  } catch {
    // Asked again next time, which is the harmless way to fail.
  }
}

const SMALL_BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 font-bold font-head text-[0.875rem] transition-colors';

export function RsvpSheet({
  event,
  status,
  askPhone,
  reachesHost = true,
  host = null,
  onChange,
  onSavePhone,
  onClose,
}: {
  event: SheetEvent;
  status: RsvpStatus;
  /**
   * Whether Going is an RSVP the host sees (rsvpReachesHost). Where it is
   * not, the sheet says to follow up with them (the owner, 2026-11-04).
   */
  reachesHost?: boolean;
  /** Who the host is, by name, if known. */
  host?: string | null;
  /** Going, and the club has no number for them. */
  askPhone: boolean;
  /** Changes the answer, as the screen's own buttons do. */
  onChange: (next: RsvpStatus) => void;
  /** Resolves to null on success, or to a sentence to show. */
  onSavePhone: (typed: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId();
  const fieldId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(dialog, heading, onClose);
  const going = status === 'going';
  const register = safeHref(event.registrationUrl);
  // Only where there is an RSVP button to press, and no sign-up saying its own piece.
  const nudge = !going && event.handAdded && !register;

  function save() {
    if (saving || !isCompletePhone(typed)) return;
    setSaving(true);
    setFailure(null);
    void onSavePhone(typed)
      .then((said) => {
        if (said) setFailure(said);
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'Your number was not saved.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 z-[70] bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'absolute z-[71] flex flex-col bg-paper',
          'inset-x-0 bottom-0 max-h-[88%] rounded-t-3xl shadow-[0_-14px_40px_rgba(10,20,35,.3)]',
          'lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:max-h-[82%] lg:w-[480px]',
          'lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl',
          'lg:shadow-[0_24px_60px_rgba(10,20,35,.35)]',
        )}
      >
        <SheetGrip sheet={dialog} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-[18px] pt-1 pb-2 lg:pt-5">
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="font-extrabold font-head text-[1.3125rem] text-ink tracking-[-0.01em] outline-none"
          >
            {going ? 'You’re going' : 'You’re interested'}
          </h2>
          <p className="mt-0.5 font-bold text-[0.875rem] text-ink2 leading-[1.4]">{event.title}</p>

          {/* Said plainly and first (the owner, 2026-10-27). */}
          {going || nudge ? (
            <p
              className={cn(
                'mt-3 rounded-[11px] px-3 py-2.5 text-[0.875rem] leading-[1.5]',
                going ? 'bg-tint font-semibold text-ink' : 'text-ink2',
              )}
            >
              {going
                ? reachesHost
                  ? GOING_SHARES_CONTACT
                  : `This doesn’t send ${host ?? 'the host'} an RSVP, so check with them if they need one. Other members can see you’re going.`
                : 'Make sure to RSVP if you decide to go, so the organizers know you’re coming.'}
            </p>
          ) : null}
          {going ? (
            <button
              type="button"
              onClick={() => {
                onChange('interested');
              }}
              className="mt-1 min-h-11 font-bold text-[0.84375rem] text-emphasis underline underline-offset-2"
            >
              Change to Interested
            </button>
          ) : null}

          {/* The host's own sign-up is separate (the owner, 2026-10-27). */}
          {register ? (
            <div className="mt-3 rounded-[14px] border border-gold/60 bg-gold-lt p-3">
              <p className="text-[0.84375rem] text-ink leading-[1.5]">
                <b className="font-extrabold font-head">The host has its own sign-up.</b> This
                doesn't register you with them, so finish on their site if you haven't.
              </p>
              <a
                href={register}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  SMALL_BUTTON,
                  'mt-2 inline-flex bg-action text-white hover:bg-action-hi',
                )}
              >
                Register on their site
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          ) : null}

          {going && askPhone ? (
            <div className="mt-3 rounded-[14px] bg-tint/60 p-3">
              <label
                htmlFor={fieldId}
                className="block font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]"
              >
                Phone number (optional)
              </label>
              <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
                It helps the host reach you on the day.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  id={fieldId}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={typed}
                  placeholder="(408) 555-0112"
                  onChange={(e) => {
                    setTyped(formatPhoneInput(e.target.value));
                  }}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border-[1.6px] border-line bg-paper px-3 text-[1rem] text-ink outline-none focus:border-emphasis"
                />
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !isCompletePhone(typed)}
                  className={cn(
                    SMALL_BUTTON,
                    'bg-action text-white hover:bg-action-hi disabled:opacity-40',
                  )}
                >
                  {saving ? 'Saving…' : 'Save number'}
                </button>
              </div>
              {failure ? (
                <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
                  {failure} You are still going.
                </p>
              ) : null}
            </div>
          ) : null}

          <h3 className="mt-4 font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
            Add to your calendar
          </h3>
          {!isNative() ? (
            <p className="mt-1 text-[0.8125rem] text-ink2">
              This saves a copy. If the date changes or is canceled, update your calendar yourself.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                SMALL_BUTTON,
                'border-[1.6px] border-emphasis text-emphasis hover:bg-tint',
              )}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Google Calendar
            </a>
            {/* The app's web view cannot hand a file to the phone's calendar. */}
            {isNative() ? null : (
              <button
                type="button"
                onClick={() => {
                  downloadIcs(event);
                }}
                className={cn(
                  SMALL_BUTTON,
                  'border-[1.6px] border-emphasis text-emphasis hover:bg-tint',
                )}
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Apple or Outlook
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-none justify-end border-line border-t px-[18px] pt-3 pb-6 lg:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] rounded-xl bg-tint px-6 font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-line"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}

interface Open {
  event: SheetEvent;
  status: RsvpStatus;
  askPhone: boolean;
  onChange: (next: RsvpStatus) => void;
}

/**
 * For a screen with Going and Interested buttons: call `saved(event, status,
 * change)` once an answer is saved, and render `sheet`. A new answer opens
 * the sheet; taking one back only says so. `change` is the screen's own way
 * to answer, for the sheet's "Change to Interested".
 */
export function useRsvpSheet(userId: string | null) {
  const announce = useAnnounce();
  const [open, setOpen] = useState<Open | null>(null);
  const { byId } = useOrganizations();
  const organizationOf = useCallback(
    (event: SheetEvent) => (event.organizationId ? (byId.get(event.organizationId) ?? null) : null),
    [byId],
  );

  const saved = useCallback(
    (event: SheetEvent, status: RsvpStatus | null, change: (next: RsvpStatus) => void) => {
      if (status === null) {
        setOpen(null);
        announce(rsvpSaved(null));
        return;
      }
      setOpen({ event, status, askPhone: false, onChange: change });
      // No number for a host that is not told anyway.
      if (status !== 'going' || !userId || skippedThisSession()) return;
      if (!rsvpReachesHost(event, organizationOf(event))) return;
      void loadOwnPhone(userId).then((result) => {
        // A number that could not be read is not a reason to ask for one.
        if (!result.ok || result.phone !== null) return;
        setOpen((current) =>
          current?.event.id === event.id && current.status === 'going'
            ? { ...current, askPhone: true }
            : current,
        );
      });
    },
    [userId, announce, organizationOf],
  );

  const close = useCallback(() => {
    setOpen((current) => {
      if (current?.askPhone) rememberSkip();
      return null;
    });
  }, []);

  const sheet = open ? (
    <RsvpSheet
      key={`${open.event.id}:${open.status}`}
      event={open.event}
      status={open.status}
      askPhone={open.askPhone}
      reachesHost={rsvpReachesHost(open.event, organizationOf(open.event))}
      host={organizationOf(open.event)?.name ?? open.event.hostName}
      onChange={open.onChange}
      onClose={close}
      onSavePhone={async (typed) => {
        if (!userId) return 'Sign in first.';
        const result = await saveOwnPhone(userId, typed);
        if (!result.ok) return result.error;
        announce('Number saved.');
        setOpen((current) => (current ? { ...current, askPhone: false } : current));
        return null;
      }}
    />
  ) : null;

  return { saved, sheet };
}
