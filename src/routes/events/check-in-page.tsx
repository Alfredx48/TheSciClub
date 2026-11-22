import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ScreenBack } from '@/components/back-line';
import { useAccount } from '@/lib/account';
import { missedCheckInHelpOpen, useCheckInPhase } from '@/lib/check-ins';
import { fetchPublicEvent, type PublicEvent } from '@/lib/event-audience';
import { CheckInCard, CheckInClosed, CheckInNotYet } from '@/routes/events/check-in-card';
import { longWhen } from '@/routes/events/format';

/**
 * What a printed QR code opens (the owner, 2026-10-30): the event's name and
 * one button. It reads the public page's event, so somebody the audience
 * leaves out can check in to the event they are standing at.
 */
export default function CheckInPage() {
  const { id = '' } = useParams<{ id: string }>();
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const phase = useCheckInPhase(event);

  useEffect(() => {
    let live = true;
    void fetchPublicEvent(id).then((result) => {
      if (!live) return;
      if (result.ok) setEvent(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[var(--events-measure)] flex-col px-4 pt-2 pb-10">
        <ScreenBack />
        {error ? (
          <p role="alert" className="text-[0.875rem] text-destructive">
            {error}
          </p>
        ) : null}
        {event === undefined && !error ? (
          <p role="status" className="py-8 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : null}
        {event === null ? (
          <p className="py-8 text-center text-[0.875rem] text-ink2">
            This event is not on the calendar.
          </p>
        ) : null}
        {event ? (
          <>
            <p className="font-bold text-[0.75rem] text-grey uppercase tracking-[0.13em]">
              Check in
            </p>
            <h1 className="mt-1 font-extrabold font-display text-[1.5rem] text-ink leading-tight">
              {event.title}
            </h1>
            <p className="mt-1.5 text-[0.875rem] text-ink2">
              {longWhen(event.startTime, event.timezone ?? 'America/Los_Angeles', event.allDay)}
            </p>
            {phase === 'open' ? (
              <CheckInCard
                eventId={event.id}
                eventTitle={event.title}
                memberId={memberId}
                organizationId={event.organization?.id ?? null}
                hostName={event.organization?.name ?? null}
              />
            ) : phase === 'over' ? (
              <CheckInClosed
                eventId={event.id}
                eventTitle={event.title}
                memberId={memberId}
                offerHelp={missedCheckInHelpOpen(event)}
              />
            ) : (
              <CheckInNotYet />
            )}
            <Link
              to={`/events/${event.id}`}
              className="mt-4 inline-block font-bold text-[0.875rem] text-emphasis"
            >
              See the event
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
