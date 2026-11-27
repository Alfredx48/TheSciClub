import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OwnBack } from '@/components/back-line';
import { useAnnounce } from '@/lib/announce';
import { useRealtimeRows } from '@/lib/chat/realtime';
import {
  addGuest,
  fetchGuestList,
  GUEST_STATE_LABEL,
  GUEST_STATUS_LABEL,
  type Guest,
  type GuestState,
  guestListCsv,
  inviteGuest,
  removeGuest,
  setGuestCheckedIn,
} from '@/lib/event-audience';
import { useEvents } from '@/lib/events';
import { addedButNotSent, sendInvite } from '@/lib/send-invite';
import { cn } from '@/lib/utils';
import { EventDeclinesList } from '@/routes/events/event-declines-list';
import { EventInviteList } from '@/routes/events/event-invite-list';
import { EventInviteTracking } from '@/routes/events/event-invite-tracking';
import { EventJoinRequests } from '@/routes/events/event-join-requests';

/**
 * An event's guest list, for its organizers and the club's administrators
 * (event_guest_list, 20261022190000): members who said Going or Interested,
 * and people who registered on its public page and are not members yet. The
 * database refuses anybody else.
 *
 * "Not confirmed" is somebody who only filled in the form: the address has
 * not been proven theirs. "Joining" has an account and has not finished.
 *
 * The owner, 2026-11-13 (20261113110000): the same people tick who was there,
 * once the event has started and for ever after; add a guest by hand; and
 * remove one at any time. Members who checked in without saying Going are
 * listed too, as having come.
 *
 * Live (the owner, 2026-11-13): a member who checks in themselves, or is
 * ticked by another organizer, is ticked here as it happens
 * (event_check_ins in supabase_realtime, 20261113120000). An untick is not
 * heard (Realtime cannot filter deletes); it shows on the next return to the
 * page. The boxes appear by themselves when the event starts.
 */

const TAG: Record<GuestState, string> = {
  member: 'bg-[#e3efe6] text-[#23633a]',
  joining: 'bg-gold-lt text-gold-dp',
  unconfirmed: 'bg-tint text-ink2',
};

export default function GuestListPage() {
  const { id = '' } = useParams<{ id: string }>();
  const announce = useAnnounce();
  const { events } = useEvents({ id });
  const event = events.find((e) => e.id === id) ?? null;
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [, setNow] = useState(0);
  const startsAt = event ? Date.parse(event.startTime) : null;
  const started = startsAt !== null && startsAt <= Date.now();

  useRealtimeRows({
    table: 'event_check_ins',
    filter: `event_id=eq.${id}`,
    enabled: id !== '',
    onChange: () => {
      setVersion((v) => v + 1);
    },
  });

  // A page opened before the start shows its boxes at the start.
  useEffect(() => {
    if (startsAt === null || started) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.min(Math.max(startsAt - Date.now(), 0) + 500, 2 ** 31 - 1),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [startsAt, started]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is how adding a guest reads the list again.
  useEffect(() => {
    let cancelled = false;
    void fetchGuestList(id).then((result) => {
      if (cancelled) return;
      if (result.ok) setGuests(result.value);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const going = guests?.filter((g) => g.status === 'going').length ?? 0;
  const interested = guests?.filter((g) => g.status === 'interested').length ?? 0;
  const outside = guests?.filter((g) => g.state !== 'member').length ?? 0;
  const here = guests?.filter((g) => g.checkedIn).length ?? 0;

  function tick(guest: Guest, checked: boolean) {
    setActionError(null);
    const swap = (to: boolean) => {
      setGuests((current) =>
        (current ?? []).map((g) =>
          g === guest || sameGuest(g, guest) ? { ...g, checkedIn: to } : g,
        ),
      );
    };
    swap(checked);
    void setGuestCheckedIn(id, guest, checked).then((result) => {
      if (result.ok) {
        announce(checked ? `${guest.name} is checked in.` : `${guest.name} is not checked in.`);
        return;
      }
      swap(!checked);
      setActionError(result.error);
    });
  }

  function remove(guest: Guest) {
    const ok = window.confirm(
      guest.memberId
        ? `Take ${guest.name} off the guest list? Their RSVP and check-in are removed. They can still say Going again.`
        : `Take ${guest.name} off the guest list?`,
    );
    if (!ok) return;
    setActionError(null);
    void removeGuest(id, guest).then((result) => {
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setGuests((current) => (current ?? []).filter((g) => !sameGuest(g, guest)));
      announce(`${guest.name} is off the guest list.`);
    });
  }

  function copyList() {
    if (!guests) return;
    const text = guests
      .map((g) =>
        [g.name, GUEST_STATUS_LABEL[g.status], g.checkedIn ? 'Checked in' : null, g.email, g.phone]
          .filter(Boolean)
          .join(' · '),
      )
      .join('\n');
    void navigator.clipboard.writeText(text).then(
      () => {
        announce('The guest list is copied.');
      },
      () => {
        announce('Could not copy the list.');
      },
    );
  }

  function downloadCsv() {
    if (!guests) return;
    const blob = new Blob([guestListCsv(guests)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(event?.title ?? 'event').replace(/[^\w -]+/g, '').trim() || 'event'} guests.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 pt-4 pb-10">
        <OwnBack to={`/events/${id}`} label={event?.title ?? 'The event'}>
          <Link to={`/events/${id}`} className="font-bold text-[0.875rem] text-emphasis">
            ← {event?.title ?? 'The event'}
          </Link>
        </OwnBack>
        <h1 className="mt-2 font-extrabold font-display text-[1.5rem] text-ink">Guest list</h1>
        <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
          For the event's organizers and the club's administrators only. Members are listed when
          they RSVP. Registrations from the public page are listed either way.{' '}
          {started
            ? 'Tick who was there, at any time from now on.'
            : 'Once the event starts, you can tick who was there.'}
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-[0.875rem] text-destructive">
            {error}
          </p>
        ) : null}
        {guests === null && !error ? (
          <p role="status" className="py-8 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : null}

        {guests ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Going', going],
                ['Interested', interested],
                ['Not in the club', outside],
                ['Checked in', here],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[12px] border border-line bg-paper px-3 py-2">
                  <dd className="font-extrabold font-head text-[1.25rem] text-ink">{value}</dd>
                  <dt className="text-[0.75rem] text-grey">{label}</dt>
                </div>
              ))}
            </dl>

            <EventJoinRequests
              eventId={id}
              onApproved={() => {
                setVersion((v) => v + 1);
              }}
            />

            {actionError ? (
              <p role="alert" className="mt-3 text-[0.8125rem] text-destructive leading-[1.45]">
                {actionError}
              </p>
            ) : null}

            {guests.length === 0 ? (
              <p className="mt-6 text-center text-[0.875rem] text-ink2">Nobody yet.</p>
            ) : (
              <ul className="mt-3 rounded-[14px] border border-line bg-paper px-3.5">
                {guests.map((guest, index) => (
                  <li
                    // Name and address together are the guest; the index keeps
                    // two who typed the same name apart.
                    key={`${guest.memberId ?? guest.registrationId ?? ''}-${guest.name}-${String(index)}`}
                    className="flex items-start gap-3 border-line border-b py-3 last:border-b-0"
                  >
                    {started ? (
                      // A finger-sized target round a box the size of the name.
                      // A walk-in is on the list only by their check-in, so
                      // unticking would drop them for good, and ticking again
                      // is refused without a Going (the Fable review,
                      // 2026-11-13): their box stays ticked; Remove takes them off.
                      <label className="-my-2.5 -ml-2.5 flex h-11 w-11 flex-none items-center justify-center">
                        <input
                          type="checkbox"
                          checked={guest.checkedIn}
                          disabled={guest.status === 'walk_in'}
                          onChange={(e) => {
                            tick(guest, e.target.checked);
                          }}
                          aria-label={`${guest.name} was there`}
                          className="h-6 w-6 accent-[var(--action)] disabled:opacity-60"
                        />
                      </label>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-[0.9375rem] text-ink">
                        {guest.name}
                      </span>
                      <span className="block break-words text-[0.8125rem] text-ink2 leading-[1.45]">
                        {[GUEST_STATUS_LABEL[guest.status], guest.email, guest.phone]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <GuestInvite
                        guest={guest}
                        onInvited={(inviteId) => {
                          setGuests((current) =>
                            (current ?? []).map((g) =>
                              g === guest ? { ...g, invite: 'pending', inviteId } : g,
                            ),
                          );
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          remove(guest);
                        }}
                        aria-label={`Remove ${guest.name} from the guest list`}
                        className="mt-0.5 min-h-11 font-bold text-[0.8125rem] text-grey underline underline-offset-2"
                      >
                        Remove
                      </button>
                    </span>
                    <span
                      className={cn(
                        'flex-none whitespace-nowrap rounded-full px-2.5 py-1 font-bold font-head text-[0.6875rem]',
                        TAG[guest.state],
                      )}
                    >
                      {GUEST_STATE_LABEL[guest.state]}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <EventDeclinesList eventId={id} />

            <AddGuest
              eventId={id}
              onAdded={(name) => {
                announce(`${name} is on the guest list.`);
                setVersion((v) => v + 1);
              }}
            />
            {event ? (
              <EventInviteList
                event={event}
                onSent={() => {
                  setVersion((v) => v + 1);
                }}
              />
            ) : null}
            {/* Read again after a list is sent. */}
            <EventInviteTracking key={version} eventId={id} />

            {guests.length > 0 ? (
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={copyList}
                  className="flex min-h-[46px] flex-1 items-center justify-center rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
                >
                  Copy the list
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="flex min-h-[46px] flex-1 items-center justify-center rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
                >
                  Download CSV
                </button>
              </div>
            ) : null}
            <p className="mt-3 text-[0.75rem] text-grey leading-[1.5]">
              <b>Member</b>: in the club. <b>Joining</b>: signed up, not finished.{' '}
              <b>Not confirmed</b>: filled in the form only; the address has not been proven theirs.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function sameGuest(a: Guest, b: Guest): boolean {
  return a.memberId
    ? a.memberId === b.memberId
    : a.registrationId !== null && a.registrationId === b.registrationId;
}

/**
 * Somebody put on the list by hand (the owner, 2026-11-13): at the door, or
 * told some other way. A name is enough; an email lets them be invited to the
 * club from here later.
 */
function AddGuest({ eventId, onAdded }: { eventId: string; onAdded: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ids = { name: useId(), email: useId(), phone: useId() };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
      >
        Add a guest
      </button>
    );
  }

  const field =
    'mt-1 min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3 py-2 text-[1rem] text-ink outline-none focus:border-emphasis';
  const label = 'mt-3 block font-bold font-head text-[0.8125rem] text-ink';

  return (
    <form
      className="mt-3 rounded-[14px] border border-line bg-paper p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setFailure('Give the guest’s name.');
          return;
        }
        setBusy(true);
        setFailure(null);
        void addGuest(eventId, { name, email, phone }).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setFailure(result.error);
            return;
          }
          onAdded(name.trim());
          setName('');
          setEmail('');
          setPhone('');
          setOpen(false);
        });
      }}
    >
      <p className="font-bold font-head text-[0.9375rem] text-ink">Add a guest</p>
      <label htmlFor={ids.name} className={label}>
        Name
      </label>
      <input
        id={ids.name}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        maxLength={100}
        autoComplete="off"
        className={field}
      />
      <label htmlFor={ids.email} className={label}>
        Email <span className="font-normal text-grey">(optional)</span>
      </label>
      <input
        id={ids.email}
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        autoComplete="off"
        className={field}
      />
      <label htmlFor={ids.phone} className={label}>
        Phone <span className="font-normal text-grey">(optional)</span>
      </label>
      <input
        id={ids.phone}
        type="tel"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
        }}
        maxLength={32}
        autoComplete="off"
        className={field}
      />
      {failure ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {failure}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2.5">
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-[46px] flex-1 items-center justify-center rounded-[13px] bg-gold font-bold font-head text-[0.875rem] text-on-gold disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add to the list'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFailure(null);
          }}
          className="min-h-[46px] px-3 text-[0.875rem] text-grey"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * For somebody who registered on the public page and is not in the club (the
 * owner, 2026-11-04): an invite to their address, whose link starts
 * onboarding with the name and phone they gave (20261104000000). Once on the
 * list, it says so, and offers to send the email again where this viewer may.
 */
function GuestInvite({
  guest,
  onInvited,
}: {
  guest: Guest;
  onInvited: (inviteId: string) => void;
}) {
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; failed: boolean } | null>(null);

  // Somebody added by hand with no email has no address to invite.
  if (
    !guest.registrationId ||
    !guest.email ||
    guest.state === 'member' ||
    guest.invite === 'consumed'
  ) {
    return null;
  }
  const registrationId = guest.registrationId;

  function invite() {
    setBusy(true);
    setSaid(null);
    void inviteGuest(registrationId).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setSaid({ text: result.error, failed: true });
        return;
      }
      onInvited(result.inviteId);
      if (result.sendError) {
        setSaid({ text: addedButNotSent(result.sendError), failed: true });
        return;
      }
      setSaid({ text: `Invite sent to ${guest.email ?? 'them'}.`, failed: false });
      announce(`Invite sent to ${guest.name}.`);
    });
  }

  function sendAgain(inviteId: string) {
    setBusy(true);
    setSaid(null);
    void sendInvite(inviteId).then((result) => {
      setBusy(false);
      setSaid(
        result.ok
          ? { text: `Sent again to ${guest.email ?? 'them'}.`, failed: false }
          : { text: result.error, failed: true },
      );
    });
  }

  return (
    <span className="mt-1.5 block">
      {guest.invite === 'pending' ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold text-[0.8125rem] text-ink2">Invited</span>
          {guest.inviteId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (guest.inviteId) sendAgain(guest.inviteId);
              }}
              className="min-h-11 font-bold text-[0.8125rem] text-emphasis underline underline-offset-2 disabled:opacity-50"
            >
              Send again
            </button>
          ) : null}
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={invite}
          aria-label={`Invite ${guest.name} to the club`}
          className="inline-flex min-h-11 items-center rounded-[11px] bg-action px-3.5 font-bold font-head text-[0.8125rem] text-white transition-colors hover:bg-action-hi disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Invite to the club'}
        </button>
      )}
      {said ? (
        <span
          role={said.failed ? 'alert' : 'status'}
          className={cn(
            'mt-1 block text-[0.78125rem] leading-[1.45]',
            said.failed ? 'text-danger-ink' : 'text-ink2',
          )}
        >
          {said.text}
        </span>
      ) : null}
    </span>
  );
}
