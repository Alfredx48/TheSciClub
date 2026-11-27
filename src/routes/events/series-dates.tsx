import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OwnBack } from '@/components/back-line';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import {
  cancelEvent,
  deleteEventAndLater,
  fetchSeriesDates,
  HAND_ADDED_TIMEZONE,
  type SeriesDate,
  useEvents,
} from '@/lib/events';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { cn } from '@/lib/utils';
import { shortDate, shortWeekday, timeRange } from '@/routes/events/format';
import { useMayChangeEvent } from '@/routes/events/may-change-event';
import { cadenceOfStarts, repeatsLine } from '@/routes/events/series-groups';

/**
 * A repeating event's dates still to come, by month, each with Cancel, and
 * Stop repeating under them (the owner, 2026-11-27): a list rather than a
 * calendar, since every date is there to read without paging months, and
 * each row is big enough to press.
 *
 * Cancel keeps the date, marked Cancelled (cancel_event, 20261127100000).
 * Stop repeating deletes every date from the next one on
 * (delete_event_and_later); either way, who said Going or Interested is told.
 */
export default function SeriesDatesPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const account = useAccount();
  const mine = useMyOrganizations(account.status === 'member' ? account.userId : null);
  const { events, loading } = useEvents({ id });
  const event = events.find((e) => e.id === id) ?? null;
  const changeable = useMayChangeEvent(
    event,
    account.status === 'member',
    account.status === 'member' && account.isAdmin,
    mine.ids,
  );
  const seriesId = event?.seriesId ?? null;
  const [dates, setDates] = useState<SeriesDate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version reads the dates again after a change.
  useEffect(() => {
    if (!seriesId) return;
    let live = true;
    void fetchSeriesDates(seriesId).then((result) => {
      if (!live) return;
      if (result.ok) setDates(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [seriesId, version]);

  const title = event?.title ?? 'The event';
  const back = (
    <OwnBack to={`/events/${id}`} label={title}>
      <Link to={`/events/${id}`} className="font-bold text-[0.875rem] text-emphasis">
        ← {title}
      </Link>
    </OwnBack>
  );

  if (loading || (event && seriesId && dates === null && !error)) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  if (!event || !seriesId) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 pt-4 pb-10">
          {back}
          <p className="mt-6 text-center text-[0.875rem] text-ink2">
            {event ? 'This event doesn’t repeat.' : 'This event is not on the calendar.'}
          </p>
        </div>
      </div>
    );
  }

  const may = changeable.may && event.handAdded;
  const list = dates ?? [];
  const cadence = repeatsLine(cadenceOfStarts(list.map((d) => d.startTime)));
  const open = list.filter((d) => !d.cancelled);
  const told = open.reduce((sum, d) => sum + d.goingCount + d.interestedCount, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 pt-4 pb-10">
        {back}
        <h1 className="mt-2 font-extrabold font-display text-[1.5rem] text-ink leading-[1.25]">
          Dates
        </h1>
        <p className="mt-0.5 font-bold text-[0.9375rem] text-ink">{title}</p>
        {cadence ? <p className="text-[0.8125rem] text-ink2">{cadence}</p> : null}
        <p className="mt-2 text-[0.8125rem] text-ink2 leading-[1.45]">
          {!event.handAdded
            ? 'This event comes from its organization’s calendar, so its dates are changed there.'
            : may
              ? 'Cancel a date and whoever said Going or Interested is told. It stays on the calendar, marked Cancelled.'
              : 'Only its organizers can cancel a date.'}
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-[0.875rem] text-destructive">
            {error}
          </p>
        ) : null}

        {dates?.length === 0 ? (
          <p className="mt-6 text-center text-[0.875rem] text-ink2">No dates to come.</p>
        ) : null}

        {byMonth(list).map(([month, rows]) => (
          <section key={month} className="mt-5">
            <h2 className="mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
              {month}
            </h2>
            <ul className="rounded-[14px] border border-line bg-paper px-3.5">
              {rows.map((date) => (
                <DateRow
                  key={date.id}
                  date={date}
                  may={may}
                  onCancelled={(n) => {
                    announce(
                      n > 0
                        ? `Cancelled. ${people(n)} told.`
                        : 'Cancelled. Nobody had answered it yet.',
                    );
                    setVersion((v) => v + 1);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}

        {may && open.length > 0 ? (
          <StopRepeating
            firstId={list[0]?.id ?? ''}
            dates={list.length}
            told={told}
            onStopped={() => {
              announce('It no longer repeats. Its dates to come are deleted.');
              void navigate('/events', { replace: true });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function DateRow({
  date,
  may,
  onCancelled,
}: {
  date: SeriesDate;
  may: boolean;
  onCancelled: (told: number) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = date.timezone ?? HAND_ADDED_TIMEZONE;
  const day = `${shortWeekday(date.startTime, tz)}, ${shortDate(date.startTime, tz)}`;
  const answers = date.goingCount + date.interestedCount;

  function confirm() {
    setBusy(true);
    setError(null);
    void cancelEvent(date.id).then((result) => {
      setBusy(false);
      if (result.ok) {
        setAsking(false);
        onCancelled(result.told ?? 0);
      } else setError(result.error ?? 'The date was not cancelled.');
    });
  }

  return (
    <li className="border-line border-b py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block font-bold text-[0.9375rem]',
              date.cancelled ? 'text-grey line-through' : 'text-ink',
            )}
          >
            {day}
          </span>
          <span className="block text-[0.8125rem] text-ink2 leading-[1.45]">
            {date.cancelled
              ? 'Cancelled'
              : [
                  timeRange(date.startTime, date.endTime, tz, date.allDay),
                  answersLine(date.goingCount, date.interestedCount),
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </span>
        {may && !date.cancelled && !asking ? (
          <button
            type="button"
            onClick={() => {
              setAsking(true);
            }}
            aria-label={`Cancel ${day}`}
            className="min-h-[44px] flex-none rounded-[11px] border-[1.6px] border-destructive/60 px-3.5 font-bold font-head text-[0.875rem] text-destructive hover:bg-destructive/5"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-2.5 rounded-[12px] border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-[0.875rem] text-ink leading-[1.45]">
            Cancel {day}?{' '}
            {answers > 0
              ? `${people(answers)} who said Going or Interested will be told.`
              : 'Nobody has answered it yet.'}{' '}
            It can’t be undone.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="flex min-h-[44px] items-center justify-center rounded-[11px] bg-destructive-fill px-3 font-bold font-head text-[0.875rem] text-white disabled:opacity-40"
            >
              {busy ? 'Cancelling…' : 'Cancel this date'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                setError(null);
              }}
              disabled={busy}
              className="flex min-h-[44px] items-center justify-center rounded-[11px] border-[1.6px] border-line px-3 font-bold font-head text-[0.875rem] text-ink"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function StopRepeating({
  firstId,
  dates,
  told,
  onStopped,
}: {
  firstId: string;
  dates: number;
  told: number;
  onStopped: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setBusy(true);
    setError(null);
    void deleteEventAndLater(firstId).then((result) => {
      setBusy(false);
      if (result.ok) onStopped();
      else setError(result.error ?? 'It was not stopped.');
    });
  }

  return (
    <section className="mt-6">
      {asking ? (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 p-3.5">
          <p className="text-[0.875rem] text-ink leading-[1.45]">
            Stop it repeating? All {dates} dates above are deleted.{' '}
            {told > 0
              ? `${people(told)} who said Going or Interested will be told.`
              : 'Nobody has answered them yet.'}{' '}
            It can’t be undone.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] bg-destructive-fill px-3 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
            >
              {busy ? 'Stopping…' : 'Stop repeating'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                setError(null);
              }}
              disabled={busy}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-line px-3 font-bold font-head text-[0.9375rem] text-ink"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAsking(true);
          }}
          className="flex min-h-[44px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-destructive/60 font-bold font-head text-[0.9375rem] text-destructive hover:bg-destructive/5"
        >
          Stop repeating
        </button>
      )}
    </section>
  );
}

/** The dates under their month, "December 2026", in the date's own zone. */
export function byMonth(dates: readonly SeriesDate[]): [string, SeriesDate[]][] {
  const groups = new Map<string, SeriesDate[]>();
  for (const date of dates) {
    const month = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: date.timezone ?? HAND_ADDED_TIMEZONE,
    }).format(new Date(date.startTime));
    groups.set(month, [...(groups.get(month) ?? []), date]);
  }
  return [...groups];
}

function answersLine(going: number, interested: number): string {
  if (going === 0 && interested === 0) return 'No answers yet';
  return [going ? `${going} going` : null, interested ? `${interested} interested` : null]
    .filter(Boolean)
    .join(', ');
}

function people(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}
