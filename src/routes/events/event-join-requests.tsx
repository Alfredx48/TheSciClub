import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnnounce } from '@/lib/announce';
import { answerJoinRequest, fetchJoinRequests, type JoinRequest } from '@/lib/event-join-requests';

/**
 * On an event's guest list, the members asking to join it while it is invite
 * only (20261127120000; the owner, 2026-11-27), with Approve and Decline.
 * Approve invites them, and in a series every later date, and tells them;
 * Decline tells nobody. Nothing shows while nobody is asking.
 */
export function EventJoinRequests({
  eventId,
  onApproved,
}: {
  eventId: string;
  onApproved: () => void;
}) {
  const announce = useAnnounce();
  const [asks, setAsks] = useState<JoinRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchJoinRequests(eventId).then((result) => {
      if (!live) return;
      if (result.ok) setAsks(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [eventId]);

  function answer(ask: JoinRequest, approve: boolean) {
    setBusy(ask.memberId);
    setError(null);
    void answerJoinRequest(eventId, ask.memberId, approve).then((result) => {
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAsks((current) => (current ?? []).filter((a) => a.memberId !== ask.memberId));
      if (approve) {
        announce(`${ask.name} is invited, and told.`);
        onApproved();
      } else announce(`Declined. ${ask.name} isn’t told.`);
    });
  }

  if (error && !asks) {
    return (
      <p role="alert" className="mt-4 text-[0.8125rem] text-destructive">
        {error}
      </p>
    );
  }
  if (!asks || asks.length === 0) return null;

  return (
    <section aria-labelledby="asking-to-join" className="mt-5">
      <h2
        id="asking-to-join"
        className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
      >
        {`Asking to join (${String(asks.length)})`}
      </h2>
      <p className="mt-1 mb-2 text-[0.75rem] text-grey leading-[1.45]">
        Approve invites them to this date and any later ones, and tells them. Decline tells nobody.
      </p>
      {error ? (
        <p role="alert" className="mb-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
      <ul className="rounded-[14px] border border-line bg-paper px-3.5">
        {asks.map((ask) => (
          <li key={ask.memberId} className="border-line border-b py-3 last:border-b-0">
            <Link
              to={`/peers/${ask.memberId}`}
              className="font-bold text-[0.9375rem] text-ink underline-offset-2 hover:underline"
            >
              {ask.name}
            </Link>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  answer(ask, true);
                }}
                disabled={busy !== null}
                aria-label={`Approve ${ask.name}`}
                className="flex min-h-[44px] items-center justify-center rounded-[11px] bg-action px-3 font-bold font-head text-[0.875rem] text-white hover:bg-action-hi disabled:opacity-50"
              >
                {busy === ask.memberId ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => {
                  answer(ask, false);
                }}
                disabled={busy !== null}
                aria-label={`Decline ${ask.name}`}
                className="flex min-h-[44px] items-center justify-center rounded-[11px] border-[1.6px] border-line px-3 font-bold font-head text-[0.875rem] text-ink hover:bg-tint disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
