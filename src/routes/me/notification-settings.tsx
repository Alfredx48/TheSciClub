import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useEmailEventReminders } from '@/lib/email-reminders';
import {
  isAppPush,
  NOTIFICATION_KINDS,
  type NotificationState,
  useDeviceNotifications,
  useNotificationKinds,
} from '@/lib/push/notifications';
import { isAndroidApp, isNative } from '@/lib/standalone';
import { cn } from '@/lib/utils';
import { NotificationVolume } from '@/routes/me/notification-volume';
import { PauseNotifications } from '@/routes/me/pause-notifications';

/**
 * Notifications, on Me, above Display.
 *
 * About *this device*, and it says so: a member with a phone and a tablet
 * turns each on separately, and "On" here promises nothing about the other.
 *
 * Every state says which it is in and what, if anything, can be done — the
 * lib's header has the five and why iOS needs two kinds of "cannot". Not drawn
 * at all until the club can send (`notificationsOffered()`), nor while the
 * state is being read, so it never shows a button that is about to change.
 * In the iPhone app a refusal has a way to the club's page in Settings.
 *
 * The sentence is a polite live region, so pressing the button is answered
 * aloud: the words change from "Off on this device." to "On for this device."
 * and a screen reader says the new ones.
 */

const SENTENCES: Record<NotificationState, string> = {
  install:
    'To get notifications on an iPhone, add the club to your Home Screen: tap Share, then Add to Home Screen, and open it from there. You will sign in again once, inside the app.',
  unsupported:
    'This device cannot show the club’s notifications. On an iPhone they need iOS 16.4 or later.',
  off: 'Off on this device.',
  on: 'On for this device.',
  refused:
    'This device has said no to the club’s notifications, and it will not ask again. To change it, open Settings, then Notifications, and find the club.',
};

const APP_REFUSED =
  'This iPhone has said no to the club’s notifications, and it will not ask again. To change it, open Settings, then Notifications, and turn on Allow Notifications.';

/**
 * Notification kinds are preferences for the whole account.
 *
 * Each row is one button whose name is the kind and whose pressed state is
 * whether it is on — "Being added to a group, toggle button, pressed" — so the
 * state is spoken with the name rather than in a separate word nearby.
 * Conversations, topics and rooms are not here; they have Mute where they are.
 */
function NotificationKinds({
  userId,
  isMentor,
  isAdmin,
}: {
  userId: string | null;
  isMentor: boolean;
  isAdmin: boolean;
}) {
  const { muted, busy, error, toggle } = useNotificationKinds(userId);
  const [open, setOpen] = useState(false);
  if (muted === null && error === null) return null;
  const shown = NOTIFICATION_KINDS.filter(
    (k) => k.who === 'all' || (k.who === 'mentor' && isMentor) || (k.who === 'admin' && isAdmin),
  );

  const onCount = muted ? shown.filter(({ kind }) => !muted.has(kind)).length : null;

  // Folded away behind one button (the owner, 2026-10-07): ten switches under
  // "On for this device" filled a phone screen for something most members set
  // once. The count says what is behind it without opening it.
  return (
    <div className="mt-3.5 border-line border-t pt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="notification-kinds"
        onClick={() => {
          setOpen(!open);
        }}
        className="flex min-h-[44px] w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-bold font-head text-[0.875rem] text-ink">
            Choose which notifications
          </span>
          {onCount !== null ? (
            <span className="block text-[0.75rem] text-grey">
              {onCount} of {shown.length} on
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('h-4 w-4 flex-none text-grey transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <fieldset id="notification-kinds" className="pt-1">
          <legend className="sr-only">Also notify me about</legend>
          <p className="text-[0.75rem] text-grey leading-[1.45]">
            These choices apply across your devices. Messages and replies to your posts always
            notify. A busy conversation notifies you at most every 2 minutes, saying how many are
            new, and not while you have it open. Mute a conversation, topic or room where it is.
          </p>
          {muted ? (
            <ul className="mt-2">
              {shown.map(({ kind, label }) => {
                const on = !muted.has(kind);
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={busy === kind}
                      onClick={() => {
                        toggle(kind);
                      }}
                      className="flex min-h-[44px] w-full items-center gap-3 py-1.5 text-left disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 text-[0.875rem] text-ink leading-[1.4]">
                        {label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex-none rounded-full px-[0.8em] py-[0.3em] font-bold font-head text-[0.75rem]',
                          on ? 'bg-action text-white' : 'border border-line text-ink2',
                        )}
                      >
                        {on ? 'On' : 'Off'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </fieldset>
      ) : null}
      {/* Outside the fold: a failed switch must be seen even once it is shut. */}
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Email the day before an event the member is going to: on unless switched off. */
function EmailReminders({ userId }: { userId: string }) {
  const { on, error, set } = useEmailEventReminders(userId);
  if (on === null) return null;
  return (
    <div className="mt-3 border-line border-t pt-2">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => {
          void set(!on);
        }}
        className="flex min-h-[44px] w-full items-center gap-3 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1 text-[0.875rem] text-ink leading-[1.4]">
          Email me the day before an event I am going to
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex-none rounded-full px-[0.8em] py-[0.3em] font-bold font-head text-[0.75rem]',
            on ? 'bg-action text-white' : 'border border-line text-ink2',
          )}
        >
          {on ? 'On' : 'Off'}
        </span>
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NotificationSettings({
  userId,
  isMentor = false,
  isAdmin = false,
}: {
  userId: string | null;
  isMentor?: boolean;
  isAdmin?: boolean;
}) {
  const { state, busy, error, turnOn, turnOff } = useDeviceNotifications(userId);
  if (state === null && error === null) return null;
  const showKinds = state === 'on' || (state === 'off' && !isNative() && !isAppPush());

  return (
    <section aria-labelledby="notification-settings-heading" className="mt-6">
      <h2
        id="notification-settings-heading"
        className="mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
      >
        Notifications
      </h2>

      <div className="rounded-[17px] border border-line bg-paper p-3.5">
        {state ? (
          <p aria-live="polite" className="text-[0.875rem] text-ink2 leading-[1.45]">
            {state === 'refused' && isAppPush() && !isAndroidApp() ? APP_REFUSED : SENTENCES[state]}
          </p>
        ) : null}

        {state === 'refused' && isAppPush() && isAndroidApp() ? (
          <button
            type="button"
            onClick={() => {
              void import('@/lib/push/app-push')
                .then((app) => app.openAndroidNotificationSettings())
                .catch(() => undefined);
            }}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[11px] border-[1.6px] border-emphasis font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-tint"
          >
            Open Settings
          </button>
        ) : null}
        {state === 'refused' && isAppPush() && !isAndroidApp() ? (
          // iOS opens the club's own page in Settings (Capacitor hands the
          // address to the system).
          <a
            href="app-settings:"
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[11px] border-[1.6px] border-emphasis font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-tint"
          >
            Open Settings
          </a>
        ) : null}

        {state === 'off' || state === 'on' ? (
          <button
            type="button"
            onClick={state === 'off' ? turnOn : turnOff}
            disabled={busy}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[11px] border-[1.6px] border-emphasis font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-tint disabled:opacity-50"
          >
            {busy ? 'One moment…' : state === 'off' ? 'Turn on notifications' : 'Turn off'}
          </button>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2.5 text-[0.8125rem] text-destructive leading-[1.45]">
            {error}
          </p>
        ) : null}

        {state === 'on' ? <NotificationVolume /> : null}
        {/* Wherever it can matter, not only here: the pause is the member's.
            Keyed by the state, so switching this device reads the count again. */}
        {userId ? (
          <PauseNotifications key={state} userId={userId} deviceOn={state === 'on'} />
        ) : null}
        {showKinds ? (
          <NotificationKinds userId={userId} isMentor={isMentor} isAdmin={isAdmin} />
        ) : null}
        {/* By email, whether or not this device notifies (20261028980000). */}
        {userId ? <EmailReminders userId={userId} /> : null}
      </div>
    </section>
  );
}
