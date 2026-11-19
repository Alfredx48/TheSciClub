import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ClubMark } from '@/components/club-mark';
import { useAccount } from '@/lib/account';
import { fetchEventIdByShortLink, fetchPublicEvent, type PublicEvent } from '@/lib/event-audience';
import { type EventInvite, fetchEventInvite, inviteAnswerFrom } from '@/lib/event-invite';
import { isEventOver } from '@/lib/event-over';
import { recordRsvpClick, useRecordEventView } from '@/lib/event-views';
import { HAND_ADDED_TIMEZONE } from '@/lib/events';
import { signInDoor } from '@/lib/sign-in-destination';
import { EventGallery } from '@/routes/events/event-gallery';
import { eventMeetingLink } from '@/routes/events/event-meeting-link';
import { longWhen, timeRange } from '@/routes/events/format';
import { MeetingLinkButton } from '@/routes/events/meeting-link-button';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { mapsUrl, placeLine } from '@/routes/events/place';
import { Place } from '@/routes/events/place-link';
import { EventDescription, safeHref } from '@/routes/events/rich-text';
import { InviteAccept } from '@/routes/public-event/invite-accept';

/**
 * An event's page, for anybody with the link (the owner, 2026-10-22;
 * public_event, 20261022180000; every event since 20261029110000).
 *
 * What an organization would post on its own calendar, and nothing that says
 * who is in the club: no counts, nobody's name (not even the host's, who may
 * be a member), no comments, no group chat. One RSVP button opens the
 * registration form (./register.tsx); no Interested here (the owner, 2026-11-05:
 * members still have it on their own page). A member who is signed in is sent to the
 * event's own page, which has all of that.
 *
 * The address holds the event's id or its short link (20261101070000).
 *
 * With ?invite=<token>, from an invite email (20261114020000), it shows the
 * event to that person even when it is private, with their invite at the top;
 * with &rsvp=going|interested|no too, the answer pressed in the email is saved
 * as it opens (20261114070000).
 */
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PublicEventPage() {
  const { id: given = '' } = useParams<{ id: string }>();
  const account = useAccount();
  const navigate = useNavigate();
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ link: string; id: string | null } | null>(null);
  const [params, setParams] = useSearchParams();
  const token = params.get('invite')?.trim() ?? '';
  // Going, Maybe or Can't go pressed in the invite email (20261114070000).
  const linkAnswer = inviteAnswerFrom(params.get('rsvp'));
  // Undefined while an invite link is read; null when it holds no live invite.
  const [invite, setInvite] = useState<EventInvite | null | undefined>(token ? undefined : null);
  // Undefined while a short link is looked up, null when none has it.
  const id = EVENT_ID.test(given) ? given : opened?.link === given ? opened.id : undefined;

  useEffect(() => {
    if (EVENT_ID.test(given)) return;
    let cancelled = false;
    void fetchEventIdByShortLink(given).then((result) => {
      if (cancelled) return;
      if (result.ok) setOpened({ link: given, id: result.value });
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [given]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetchEventInvite(token).then((result) => {
      if (cancelled) return;
      setInvite(result.ok ? result.value : null);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (invite) {
      setEvent(invite.event);
      return;
    }
    if (id === undefined || invite === undefined) return;
    if (id === null) {
      setEvent(null);
      return;
    }
    let cancelled = false;
    void fetchPublicEvent(id).then((result) => {
      if (cancelled) return;
      if (result.ok) setEvent(result.value);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [id, invite]);

  // An open of the public page, counted with nothing about who (20261103070000).
  useRecordEventView(
    event && account.status !== 'member' && account.status !== 'loading' ? event.id : null,
    true,
  );

  if (account.status === 'member' && id) return <Navigate to={`/events/${id}`} replace />;

  // A short link that has not resolved can be looked up again after sign-in.
  const signInHref = signInDoor(id ? `/events/${id}` : `/e/${encodeURIComponent(given)}`);
  const timezone = event?.timezone ?? HAND_ADDED_TIMEZONE;
  const over = event ? isEventOver(event) : false;
  const place = event ? placeLine(event) : null;
  const registerHref = safeHref(event?.registrationUrl ?? null);
  const pageHref = safeHref(event?.url ?? null);
  const meeting = event ? eventMeetingLink(event) : null;
  const moreHref = meeting?.inUrl ? null : pageHref;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[560px] bg-canvas pb-[max(28px,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-[18px] pt-[max(16px,env(safe-area-inset-top))] pb-3">
        <Link to="/join" aria-label="The SCI Club">
          <ClubMark size={44} className="h-11 w-auto" />
        </Link>
        <Link
          to={signInHref}
          className="font-bold font-head text-[0.875rem] text-emphasis underline"
        >
          Sign in
        </Link>
      </header>

      {event === undefined && !error ? (
        <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
          Loading…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-6 py-10 text-center text-[0.875rem] text-ink2">
          {error}
        </p>
      ) : null}
      {event === null ? (
        <div className="px-6 py-10 text-center">
          <h1 className="font-extrabold font-head text-[1.25rem] text-ink">
            This event is not on the calendar
          </h1>
          <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.5]">
            It may have been removed, the link is not complete, or it is private. If you were
            invited, sign in to see it.
          </p>
          <Link
            to={signInHref}
            className="mt-4 inline-block font-bold font-head text-[0.9375rem] text-emphasis underline"
          >
            Sign in to the club
          </Link>
        </div>
      ) : null}

      {event ? (
        <article className="px-[18px]">
          <EventGallery
            path={event.photoPath}
            alt={event.photoAlt}
            more={event.morePhotos}
            className="mb-4"
          />
          <p className="flex items-center gap-1.5 font-bold text-[0.75rem] text-gold-dp uppercase tracking-[0.07em]">
            <CalendarDays className="h-[13px] w-[13px]" aria-hidden="true" />
            {longWhen(event.startTime, timezone, event.allDay)}
          </p>
          <h1 className="mt-2 font-extrabold font-display text-[1.5rem] text-ink leading-[1.25] tracking-[-0.01em]">
            {event.title}
          </h1>
          <p className="mt-1.5 text-[0.875rem] text-ink2 leading-[1.45]">
            {timeRange(event.startTime, event.endTime, timezone, event.allDay)}
            <Place
              line={place}
              href={mapsUrl(event)}
              className="underline decoration-ink2/50 underline-offset-2 hover:text-emphasis"
            />
          </p>

          {meeting && !over ? (
            <MeetingLinkButton
              href={meeting.href}
              service={meeting.service}
              tone="page"
              className="mt-4"
            />
          ) : null}

          {invite && !over ? (
            <InviteAccept
              token={token}
              invite={invite}
              linkAnswer={linkAnswer}
              onLinkAnswered={() => {
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete('rsvp');
                    return next;
                  },
                  { replace: true },
                );
              }}
            />
          ) : null}
          {token && invite === null ? (
            <p role="status" className="mt-4 text-[0.875rem] text-ink2 leading-[1.45]">
              This invite link has been used or is no longer good. If it was yours, sign in.
            </p>
          ) : null}

          {over ? (
            <p className="mt-4 text-[0.875rem] text-grey">This event is over.</p>
          ) : invite ? null : (
            <div className="mt-4 flex gap-2.5">
              {/* Every event, also one whose host takes no RSVPs here: the form
                  says the club's list is not the host's sign-up. */}
              <button
                type="button"
                onClick={() => {
                  recordRsvpClick(event.id, true);
                  void navigate(`/e/${event.id}/register`);
                }}
                className="flex min-h-[48px] flex-1 items-center justify-center rounded-[13px] bg-gold font-bold font-head text-[0.9375rem] text-on-gold"
              >
                RSVP
              </button>
            </div>
          )}

          <EventDescription
            html={event.descriptionHtml}
            text={event.description}
            // Links as on the members' page: underlined, so they read as links.
            className="mt-5 text-[0.9375rem] text-ink leading-[1.55] [overflow-wrap:anywhere] [&>*+*]:mt-3 [&_a]:text-emphasis [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"
          />

          {moreHref || registerHref ? (
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[0.875rem]">
              {moreHref ? (
                <a
                  href={moreHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center font-bold text-emphasis underline"
                >
                  Details on their site
                </a>
              ) : null}
              {registerHref ? (
                <a
                  href={registerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center font-bold text-emphasis underline"
                >
                  The organizer's sign-up
                </a>
              ) : null}
            </p>
          ) : null}

          {/* A stronger ask to join, set apart (the owner, 2026-10-24): what
              the club adds to an event is the people and the chat. Both
              buttons go to the same door, which asks which of the two. */}
          <section
            aria-label="Join the club"
            hidden={Boolean(invite)}
            className="mt-6 rounded-[16px] bg-plate px-4 pt-4 pb-3 text-white"
          >
            <p className="font-extrabold font-head text-[1.0625rem] leading-[1.35]">
              Join the club to see who's coming and join the group chat.
            </p>
            <Link
              to={signInHref}
              className="mt-3 flex min-h-[48px] items-center justify-center rounded-[13px] bg-gold font-bold font-head text-[0.9375rem] text-on-gold"
            >
              Join the club
            </Link>
            <p className="mt-2 text-center text-[#B9CADF] text-[0.8125rem]">
              Already a member?{' '}
              <Link to={signInHref} className="inline-block py-2 font-bold text-white underline">
                Sign in
              </Link>
            </p>
          </section>

          {event.organization ? (
            <>
              <h2 className="mt-6 mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
                Hosted by
              </h2>
              <div className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3">
                <OrganizationBadge organization={event.organization} />
                <span className="font-extrabold font-head text-[0.9375rem] text-ink">
                  {event.organization.name}
                </span>
              </div>
            </>
          ) : null}
        </article>
      ) : null}
    </main>
  );
}
