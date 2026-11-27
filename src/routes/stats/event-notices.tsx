import { ChevronDown, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnnounce } from '@/lib/announce';
import { type EventVisibility, fetchEventVisibility } from '@/lib/event-audience';
import {
  type EventNotices,
  fetchEventNotices,
  fetchNotifiesMembers,
  fetchPeopleAnswers,
  type NoticeAudience,
  notifyMembers,
  type PersonAnswer,
  roleOf,
  setNotifiesMembers,
} from '@/lib/event-notices';
import { cn } from '@/lib/utils';
import type { AudienceOrganization } from '@/routes/events/audience-field';
import { audienceLabel } from '@/routes/events/event-audience-parts';
import { cadenceOfStarts, repeatsLine } from '@/routes/events/series-groups';
import { VisibilitySheet } from '@/routes/events/visibility-sheet';
import { FIRST_PEOPLE } from '@/routes/stats/organization-people';

/**
 * Telling the organization's people about its events (20261103000000): every
 * new one, or one at a time, and who opened it and answered. Each says who
 * can see it, and its org admins change that here as on its page (the owner,
 * 2026-11-06).
 */

const when = (event: EventNotices) =>
  new Date(event.startTime).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(event.allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
    timeZone: event.timezone ?? 'America/Los_Angeles',
  });

const people = (n: number) => (n === 1 ? '1 person' : `${String(n)} people`);

/** What the button says, for how many it may reach. */
export function sendLabel(who: NoticeAudience, count: number, notified = 0): string {
  switch (who) {
    case 'everyone':
      return notified === 0
        ? `Notify ${people(count)} who ${count === 1 ? 'hasn’t' : 'haven’t'} answered`
        : `Notify ${people(count)} not yet notified`;
    case 'not_opened':
      return `Remind ${String(count)} who haven’t opened it`;
    case 'no_answer':
      return `Remind ${String(count)} who haven’t answered`;
  }
}

/** What came of a press. */
export function sentMessage(count: number): string {
  return count === 0
    ? 'Nobody to notify right now. Each person can be notified once every 12 hours.'
    : `Notified ${people(count)}.`;
}

const TWELVE_HOURS = 12 * 3_600_000;

/** When a reminder may go, as "Tue 9:30 AM", or null if it may now. */
export function remindsFrom(lastSentAt: string | null, now: number = Date.now()): string | null {
  if (!lastSentAt) return null;
  const from = new Date(lastSentAt).getTime() + TWELVE_HOURS;
  if (from <= now) return null;
  return new Date(from).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Its people's answers, notified or not. */
export function answersLine(going: number, interested: number): string {
  return going + interested === 0
    ? 'None of your people have answered yet.'
    : `Your people: ${String(going)} going · ${String(interested)} interested`;
}

/** One person's line: what they did. */
export function answerStatus(a: PersonAnswer): string {
  const times = a.sends > 1 ? ` · notified ${String(a.sends)} times` : '';
  if (a.rsvp === 'going') return `Going${times}`;
  if (a.rsvp === 'interested') return `Interested${times}`;
  if (a.sends > 0) return `${a.openedAt ? 'Opened, no answer' : 'Not opened'}${times}`;
  return a.seesEvent ? 'Not notified' : 'Can’t see this event';
}

export function EventNoticesPanel({
  organizationId,
  organizationName,
  organizations,
}: {
  organizationId: string;
  organizationName: string;
  /** Whose members an event can be for: those the viewer is an org admin of. */
  organizations: AudienceOrganization[];
}) {
  const [events, setEvents] = useState<EventNotices[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    void fetchEventNotices(organizationId).then((result) => {
      if (result.ok) {
        setEvents(result.value);
        setError(null);
      } else setError(result.error);
    });
  }, [organizationId]);

  useEffect(() => {
    setEvents(null);
    setAll(false);
    load();
  }, [load]);

  const shown = events ? (all ? events : events.slice(0, FIRST_PEOPLE)) : [];
  // How often each repeating event repeats, from its dates in the list, as
  // the Events list says it (the owner, 2026-11-06).
  const repeats = repeatsBySeries(events ?? []);

  return (
    <div className="mt-4">
      <h3 className="font-extrabold font-head text-[0.875rem] text-ink">Notify your people</h3>
      <p className="mt-0.5 mb-2 text-[0.75rem] text-grey leading-[1.45]">
        Tell your org admins, mentors and members about an event, and see who opened it and who
        answered.
      </p>
      <EveryEventSwitch organizationId={organizationId} />
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : events === null ? null : events.length === 0 ? (
        <p className="mt-2.5 rounded-[14px] border border-line bg-paper px-3.5 py-4 text-center text-[0.875rem] text-grey">
          No upcoming events.
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2.5">
          {shown.map((event) => (
            <EventRow
              key={event.eventId}
              event={event}
              onSent={load}
              repeats={event.seriesId ? repeats.get(event.seriesId) : undefined}
              organizationId={organizationId}
              organizationName={organizationName}
              organizations={organizations}
            />
          ))}
        </ul>
      )}
      {events && events.length > FIRST_PEOPLE ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => {
            setAll(!all);
          }}
          className="mt-2 min-h-[44px] font-semibold text-[0.875rem] text-emphasis underline"
        >
          {all ? 'Show fewer' : `See all ${String(events.length)}`}
        </button>
      ) : null}
    </div>
  );
}

function EveryEventSwitch({ organizationId }: { organizationId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setOn(null);
    void fetchNotifiesMembers(organizationId).then((result) => {
      if (!live) return;
      if (result.ok) setOn(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [organizationId]);

  function toggle() {
    if (on === null) return;
    const next = !on;
    setBusy(true);
    setError(null);
    setOn(next);
    void setNotifiesMembers(organizationId, next).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setOn(!next);
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-[14px] border border-line bg-paper p-3.5">
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[0.9375rem] text-ink">Notify them of every new event</p>
          <p className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.45]">
            {on
              ? 'Each event you add here goes to them a few minutes after you add it. A repeating event goes once.'
              : 'Off: use Notify on an event below. Events from your own calendar are in their daily summary either way.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on === true}
          aria-label="Notify them of every new event"
          data-target="small"
          disabled={busy || on === null}
          onClick={toggle}
          className={cn(
            'relative h-[30px] w-[52px] flex-none rounded-full transition-colors disabled:opacity-50',
            on ? 'bg-action hover:bg-action-hi' : 'bg-line hover:bg-grey',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] h-6 w-6 rounded-full bg-paper transition-[left]',
              on ? 'left-[25px]' : 'left-[3px]',
            )}
          />
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-danger-ink leading-[1.4]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Repeats weekly" for each series in the list, by its id. */
export function repeatsBySeries(events: readonly EventNotices[]): Map<string, string> {
  const starts = new Map<string, string[]>();
  for (const event of events) {
    if (event.seriesId)
      starts.set(event.seriesId, [...(starts.get(event.seriesId) ?? []), event.startTime]);
  }
  return new Map([...starts].map(([id, list]) => [id, repeatsLine(cadenceOfStarts(list))]));
}

function EventRow({
  event,
  onSent,
  repeats,
  organizationId,
  organizationName,
  organizations,
}: {
  event: EventNotices;
  onSent: () => void;
  /** "Repeats weekly", for a date of a repeating event. */
  repeats: string | undefined;
  organizationId: string;
  organizationName: string;
  organizations: AudienceOrganization[];
}) {
  const announce = useAnnounce();
  const [busy, setBusy] = useState<NoticeAudience | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const over = new Date(event.startTime).getTime() < Date.now();

  function send(who: NoticeAudience) {
    setBusy(who);
    setSaid(null);
    void notifyMembers(event.eventId, who).then((result) => {
      setBusy(null);
      const message = result.ok ? sentMessage(result.value) : result.error;
      setSaid(message);
      announce(message);
      if (result.ok) {
        setRound((n) => n + 1);
        onSent();
      }
    });
  }

  // Nobody is told twice in 12 hours, so a reminder waits that long.
  const remindFrom = remindsFrom(event.lastSentAt);
  const buttons: [NoticeAudience, number][] = over
    ? []
    : (
        [
          ['everyone', event.canReach],
          ['not_opened', remindFrom ? 0 : event.notOpened],
          ['no_answer', remindFrom ? 0 : event.noAnswer],
        ] as [NoticeAudience, number][]
      ).filter(([, count]) => count > 0);

  return (
    <li className="rounded-[14px] border border-line bg-paper p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex min-h-[44px] w-full items-start gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words font-bold text-[0.9375rem] text-ink">
            {event.title}
          </span>
          <span className="mt-0.5 block text-[0.75rem] text-grey">
            {when(event)}
            {over ? ' · started' : ''}
            {repeats ? ` · ${repeats}` : ''}
          </span>
          <span className="sr-only">{open ? ', hide who answered' : ', see who answered'}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('mt-0.5 h-5 w-5 flex-none text-grey', open ? 'rotate-180' : '')}
        />
      </button>
      <p className="mt-1 text-[0.8125rem] text-ink leading-[1.45]">
        {answersLine(event.peopleGoing, event.peopleInterested)}
      </p>
      <p className="mt-0.5 text-[0.8125rem] text-ink2 leading-[1.45]">
        {event.notified === 0
          ? 'Not notified yet.'
          : `Notified ${people(event.notified)} · ${String(event.opened)} opened · ${String(event.noAnswer)} no answer`}
      </p>
      <WhoCanSee
        event={event}
        over={over}
        organizationId={organizationId}
        organizationName={organizationName}
        organizations={organizations}
        onSaved={onSent}
      />
      {/* Every date to come, to cancel one or stop it (the owner, 2026-11-27). */}
      {event.seriesId && !over ? (
        <div className="mt-2 flex items-center justify-between gap-3 border-line border-t pt-2">
          <p className="min-w-0 text-[0.8125rem] text-ink2 leading-[1.4]">
            Cancel a date, or stop it repeating
          </p>
          <Link
            to={`/events/${event.eventId}/dates`}
            aria-label={`Manage the dates of ${event.title}`}
            className="-my-1.5 flex min-h-[44px] flex-none items-center rounded-[10px] px-3 font-bold text-[0.8125rem] text-emphasis hover:bg-tint"
          >
            Dates
          </Link>
        </div>
      ) : null}
      {open ? <Answers key={round} eventId={event.eventId} /> : null}
      {buttons.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {buttons.map(([who, count]) => (
            <button
              key={who}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                send(who);
              }}
              className={cn(
                'min-h-[44px] rounded-[10px] px-3 font-semibold text-[0.8125rem] disabled:opacity-50',
                who === 'everyone'
                  ? 'bg-action text-white hover:bg-action-hi'
                  : 'bg-tint text-emphasis',
              )}
            >
              {busy === who ? 'Sending…' : sendLabel(who, count, event.notified)}
            </button>
          ))}
        </div>
      ) : null}
      {said ? <p className="mt-1.5 text-[0.8125rem] text-ink leading-[1.4]">{said}</p> : null}
      {!over && remindFrom && event.noAnswer > 0 ? (
        <p className="mt-1.5 text-[0.8125rem] text-ink2 leading-[1.4]">
          You can remind those who haven’t answered from {remindFrom}.
        </p>
      ) : null}
    </li>
  );
}

const PRIVATE = new Set(['followers', 'organizations', 'people']);

/** Who can see it, and Change, which reads its details only when pressed. */
function WhoCanSee({
  event,
  over,
  organizationId,
  organizationName,
  organizations,
  onSaved,
}: {
  event: EventNotices;
  over: boolean;
  organizationId: string;
  organizationName: string;
  organizations: AudienceOrganization[];
  onSaved: () => void;
}) {
  const [visibility, setVisibility] = useState<EventVisibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change() {
    setBusy(true);
    setError(null);
    void fetchEventVisibility(event.eventId).then((result) => {
      setBusy(false);
      if (!result.ok) setError(result.error);
      else if (!result.value?.mayChange) setError('You can’t change who sees this event.');
      else setVisibility(result.value);
    });
  }

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-line border-t pt-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-ink2 leading-[1.4]">
          {PRIVATE.has(event.audience) ? (
            <Lock aria-hidden="true" className="h-[13px] w-[13px] flex-none" strokeWidth={2.4} />
          ) : null}
          <span>
            Who can see it: {audienceLabel(event.audience, organizationName)}
            {PRIVATE.has(event.audience) ? ' (private)' : ''}
          </span>
        </p>
        {over ? null : (
          <button
            type="button"
            onClick={change}
            disabled={busy}
            aria-label={`Change who can see ${event.title}`}
            className="-my-1.5 min-h-[44px] flex-none rounded-[10px] px-3 font-bold text-[0.8125rem] text-emphasis hover:bg-tint disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Change'}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : null}
      {visibility ? (
        <VisibilitySheet
          event={{
            id: event.eventId,
            title: event.title,
            seriesId: event.seriesId,
            organizationId,
          }}
          visibility={visibility}
          organizations={organizations}
          onCancel={() => {
            setVisibility(null);
          }}
          onSaved={() => {
            setVisibility(null);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}

function Answers({ eventId }: { eventId: string }) {
  const [list, setList] = useState<PersonAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchPeopleAnswers(eventId).then((result) => {
      if (!live) return;
      if (result.ok) setList(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [eventId]);

  if (error) {
    return (
      <p role="alert" className="text-[0.8125rem] text-destructive">
        {error}
      </p>
    );
  }
  if (list === null) return <p className="py-2 text-[0.8125rem] text-grey">Loading…</p>;
  const shown = all ? list : list.slice(0, FIRST_PEOPLE);
  return (
    <div className="mt-2">
      <ul className="overflow-hidden rounded-[12px] border border-line">
        {shown.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-line border-b px-3 py-2 last:border-b-0"
          >
            <span className="min-w-0 break-words font-semibold text-[0.875rem] text-ink">
              {r.name}
              <span className="font-normal text-grey"> · {roleOf(r)}</span>
            </span>
            <span className="text-[0.8125rem] text-ink2">{answerStatus(r)}</span>
          </li>
        ))}
      </ul>
      {list.length > FIRST_PEOPLE ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => {
            setAll(!all);
          }}
          className="mt-1.5 min-h-[44px] font-semibold text-[0.8125rem] text-emphasis underline"
        >
          {all ? 'Show fewer' : `See all ${String(list.length)}`}
        </button>
      ) : null}
      <Link
        to={`/events/${eventId}`}
        className="mt-1 flex min-h-[44px] items-center font-semibold text-[0.8125rem] text-emphasis underline"
      >
        Open the event
      </Link>
    </div>
  );
}
