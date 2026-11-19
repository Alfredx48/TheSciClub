import { CalendarDays, ChevronRight, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { OwnBack } from '@/components/back-line';
import { useRsvpSheet } from '@/components/rsvp-sheet';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { missedCheckInHelpOpen, useCheckInPhase } from '@/lib/check-ins';
import { isPrivateAudience, linkIsClosed } from '@/lib/event-audience';
import { fetchMyEventDeclined, setEventDeclined } from '@/lib/event-declines';
import { useRecordEventView } from '@/lib/event-views';
import {
  deleteEvent,
  deleteEventAndLater,
  revertImportedEvent,
  setRsvp,
  useAttendeesByEvent,
  useEvents,
  useViewerEvents,
} from '@/lib/events';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { useSession } from '@/lib/session';
import { isNative } from '@/lib/standalone';
import { cn } from '@/lib/utils';
import { PostBody } from '@/routes/chat/post-body';
import { AttendeeList } from '@/routes/events/attendee-list';
import { backLabel, backState, backToEvents } from '@/routes/events/back';
import { CheckInCard, CheckInClosed, CheckInNotYet } from '@/routes/events/check-in-card';
import { EventAudienceSection, OutsideTheAudience } from '@/routes/events/event-audience-parts';
import { EventCohosts } from '@/routes/events/event-cohosts';
import { mayChangeEvent } from '@/routes/events/event-draft';
import { EventFiles } from '@/routes/events/event-files';
import { EventGallery } from '@/routes/events/event-gallery';
import { EventGroupCard } from '@/routes/events/event-group-card';
import { eventMeetingLink } from '@/routes/events/event-meeting-link';
import { EventViewsLine } from '@/routes/events/event-views';
import { isOnline, isPastEvent } from '@/routes/events/filters';
import { longWhen, rsvpReachesHost, timeRange } from '@/routes/events/format';
import { InvitationEmails } from '@/routes/events/invitation-emails';
import { MeetingLinkButton } from '@/routes/events/meeting-link-button';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { organizationTown } from '@/routes/events/organization-places';
import { OutOfStateMark } from '@/routes/events/out-of-state';
import { mapsUrl, placeLine } from '@/routes/events/place';
import { Place } from '@/routes/events/place-link';
import { PrivacyChip, privacyLabel } from '@/routes/events/privacy-chip';
import { RepeatsLine } from '@/routes/events/repeats-line';
import { EventDescription, safeHref } from '@/routes/events/rich-text';
import { SAVED_FROM_LINK, useRsvpFromLink } from '@/routes/events/rsvp-from-link';
import { ShareEventButton } from '@/routes/events/share-event';
import { ReviewsSection } from '@/routes/reviews/reviews-section';
import type { EventAttendee, RsvpStatus } from '@/types/domain';

/**
 * One event, matching `evDetail()` in the mock: a navy hero carrying the when,
 * the what and the two RSVP buttons, then the description, who is going, and
 * who is hosting.
 *
 * The group chat card the mock shows is real as of Phase 5 of Chat, and is
 * `EventGroupCard` — rendered only for a signed-in member, because the card reads the viewer's own conversations to know
 * whether they are already in the group.
 */
export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const back = backToEvents(location);
  const session = useSession();
  const announce = useAnnounce();
  const memberId = session.status === 'signed-in' ? session.userId : null;

  const { events, loading, error, reload } = useEvents({
    id: id ?? '00000000-0000-0000-0000-000000000000',
  });
  const { byEvent, reload: reloadAttendees } = useAttendeesByEvent(id ? [id] : []);
  const { byId: organizationsById, organizations } = useOrganizations();
  const viewer = useViewerEvents(memberId);
  const account = useAccount();
  const mine = useMyOrganizations(memberId);
  const [writeError, setWriteError] = useState<string | null>(null);
  const registerNote = useId();
  const goingNote = useId();

  const event = events.find((candidate) => candidate.id === id) ?? null;
  const checkInPhase = useCheckInPhase(event);
  // A view in the app (20261103070000).
  useRecordEventView(memberId && event ? event.id : null, false);

  const { saved: rsvpSheetFor, sheet: rsvpSheet } = useRsvpSheet(memberId);
  // Can't go (20261114080000): the member's own, read apart from the RSVPs.
  const eventId = event?.id ?? null;
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    setDeclined(false);
    if (!memberId || !eventId) return;
    let cancelled = false;
    void fetchMyEventDeclined(eventId).then((value) => {
      if (!cancelled) setDeclined(value);
    });
    return () => {
      cancelled = true;
    };
  }, [memberId, eventId]);

  const onRsvp = useCallback(
    (next: RsvpStatus | null) => {
      if (!memberId || !event) return;
      setWriteError(null);
      void setRsvp(event.id, memberId, next).then((result) => {
        if (result.ok) {
          // Going or Interested takes back Can't go, in the database too.
          if (next !== null) setDeclined(false);
          // The button, and the Going list and tally under it.
          viewer.reload();
          reload?.();
          reloadAttendees();
          rsvpSheetFor(event, next, onRsvp);
        } else setWriteError(result.error ?? 'Could not save that.');
      });
    },
    [memberId, event, viewer, reload, reloadAttendees, rsvpSheetFor],
  );

  const onDecline = useCallback(
    (next: boolean) => {
      if (!memberId || !eventId) return;
      setWriteError(null);
      void setEventDeclined(eventId, next).then((result) => {
        if (result.ok) {
          setDeclined(next);
          // It takes back a Going or Interested.
          viewer.reload();
          reload?.();
          reloadAttendees();
          announce(next ? 'Saved: you can’t go.' : 'Taken back.');
        } else setWriteError(result.error);
      });
    },
    [memberId, eventId, viewer, reload, reloadAttendees, announce],
  );

  // Going, Maybe or Can't go pressed in the invite email (20261114070000).
  const [fromLink, setFromLink] = useState<string | null>(null);
  const saveFromLink = useCallback(
    (answer: 'going' | 'interested' | 'no') => {
      if (answer === 'no') onDecline(true);
      else onRsvp(answer);
      setFromLink(SAVED_FROM_LINK[answer]);
    },
    [onRsvp, onDecline],
  );
  useRsvpFromLink(Boolean(memberId && event && !isPastEvent(event)), saveFromLink);

  if (loading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-[0.875rem] text-ink2">Could not load this event.</p>
        <p className="mt-2 text-[0.78125rem] text-grey">{error}</p>
      </div>
    );
  }
  if (!event) {
    // An event that has finished and been cleared, or a link somebody kept. Not
    // an error to report — just a thing that is no longer there. Or one for
    // an audience this member is not in (20261022180000): then who it is for.
    return (
      <OutsideTheAudience
        eventId={id ?? ''}
        onFollowed={() => reload?.()}
        missing={
          <div className="px-6 py-10 text-center">
            <p className="text-[0.875rem] text-ink2 leading-relaxed">
              This event is not on the calendar.
            </p>
            <button
              type="button"
              onClick={() => {
                void navigate(back);
              }}
              className="mt-4 font-bold font-head text-[0.9375rem] text-emphasis"
            >
              Back to Events
            </button>
          </div>
        }
      />
    );
  }

  const status = viewer.rsvps.get(event.id) ?? null;
  const going = status === 'going';
  const interested = status === 'interested';
  const attendees = byEvent.get(event.id) ?? [];
  // Both addresses come from another organization's website, through the
  // ingest job, which resolves the registration button's href without asking
  // what scheme it has. The description's links already pass through safeHref;
  // these two are links on the same page from the same source.
  const registerHref = safeHref(event.registrationUrl);
  const separateRegistration = registerHref !== null && !isNative();
  const pageHref = safeHref(event.url);
  // A call to join, not a page about the event: it goes up with the time, and
  // is not offered once the event is over. The event's link, or failing that
  // one in its description.
  const meeting = eventMeetingLink(event);
  const moreHref = meeting?.inUrl ? null : pageHref;
  const hasDetails =
    event.descriptionHtml.trim() !== '' ||
    event.description.trim() !== '' ||
    (moreHref !== null && moreHref !== registerHref);
  const goingList = attendees.filter((a) => a.status === 'going');
  const interestedList = attendees.filter((a) => a.status === 'interested');
  const organization = event.organizationId
    ? (organizationsById.get(event.organizationId) ?? null)
    : null;
  const host = organization?.name ?? event.hostName;
  const reachesHost = rsvpReachesHost(event, organization);
  const canChange = account.status === 'member' && mayChangeEvent(event, account.isAdmin, mine.ids);
  // Its org admins too, whose imported events they cannot change.
  // The lead host's admins, or an administrator: imported events too.
  const managesHosts =
    account.status === 'member' &&
    (account.isAdmin || (event.organizationId !== null && mine.ids.has(event.organizationId)));
  const canSeeCheckIns = canChange || managesHosts;
  // Who sees it: the same people, imported events included (20261106030000).
  const canSetVisibility = canChange || managesHosts;
  const adminOf = [...mine.ids, ...(account.isAdmin && organization ? [organization.id] : [])]
    .filter((orgId, index, all) => all.indexOf(orgId) === index)
    .flatMap((orgId) => {
      const found = organizationsById.get(orgId);
      return found
        ? [{ id: found.id, name: found.name, open: found.joinsNeedApproval !== true }]
        : [];
    });

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-plate px-4 pt-[18px] pb-5 text-white">
          <div className="mx-auto w-full max-w-[var(--events-measure)]">
            <div className="flex items-start justify-between gap-3">
              <OwnBack to={back} label={backLabel(location)} state={backState(location)} spacer>
                <button
                  type="button"
                  onClick={() => {
                    void navigate(back, { state: backState(location) });
                  }}
                  className="block pb-3 text-[#B9CADF] text-[0.875rem]"
                >
                  ← {backLabel(location)}
                </button>
              </OwnBack>
              {/* Invite only has no link to share (the owner, 2026-11-14). */}
              {memberId && !linkIsClosed(event.audience) ? (
                <ShareEventButton
                  eventId={event.id}
                  shortLink={event.shortLink ?? null}
                  title={event.title}
                  when={longWhen(event.startTime, event.timezone, event.allDay)}
                />
              ) : null}
            </div>

            <EventGallery
              path={event.photoPath}
              alt={event.photoAlt}
              more={event.morePhotos}
              className="mb-4"
            />

            {/* A calendar, because the line is a date. This was a map pin, which
              says "place" in front of text that says "Friday 11 September". */}
            <div className="flex items-center gap-1.5 font-bold text-gold-hi text-[0.71875rem] uppercase tracking-[0.07em]">
              <CalendarDays className="h-[13px] w-[13px]" aria-hidden="true" />
              <span>{longWhen(event.startTime, event.timezone, event.allDay)}</span>
            </div>

            <h1 className="mt-2 font-extrabold font-display text-[1.4375rem] leading-[1.28] tracking-[-0.01em]">
              {event.title}
            </h1>

            <p className="mt-1.5 text-[#B9CADF] text-[0.8125rem] leading-[1.42]">
              {timeRange(event.startTime, event.endTime, event.timezone, event.allDay)}
              <Place
                line={placeLine(event)}
                href={mapsUrl(event)}
                className="underline decoration-[#B9CADF]/50 underline-offset-2 hover:text-white"
              />
            </p>
            <RepeatsLine
              seriesId={event.seriesId}
              startTime={event.startTime}
              timezone={event.timezone}
              className="mt-1 text-[#B9CADF] text-[0.8125rem] leading-[1.42]"
            />
            <OutOfStateMark state={event.state} onNavy className="mt-2" />

            {isOnline(event) || event.tags.length || privacyLabel(event.audience) ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <PrivacyChip audience={event.audience} onNavy />
                {isOnline(event) ? (
                  <span className="rounded-full bg-[#3A2F12] px-2.5 py-[5px] font-semibold text-gold-hi text-[0.7375rem]">
                    {event.format === 'hybrid' ? 'Hybrid' : 'Online'}
                  </span>
                ) : null}
                {event.tags.map((tag) => (
                  <span
                    key={tag.slug}
                    className="rounded-full bg-plate-chip px-2.5 py-[5px] font-semibold text-[#DDE7F3] text-[0.7375rem]"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 pb-5">
          {/* In a warm box of its own, a size up, so it is read (the owner,
              2026-11-17: "make the details section on the event page pop out
              more ... a different color bubble ... up the font one size"). */}
          {hasDetails ? (
            <section className="mt-5 rounded-[18px] border border-gold-dp/60 bg-gold-lt px-4 pt-3.5 pb-4">
              <h2 className="mb-2 font-extrabold font-head text-[0.75rem] text-gold-ink uppercase tracking-[0.13em]">
                Details
              </h2>
              {/* Written here: its @people and @Organizations link, as in a post
                  (the owner, 2026-11-17). An imported one keeps its own HTML. */}
              {event.descriptionHtml.trim() ? (
                <EventDescription
                  html={event.descriptionHtml}
                  text={event.description}
                  className="text-[1rem] text-ink leading-[1.55] [&_a]:text-emphasis [&_a]:underline [&_h3]:mt-3.5 [&_h3]:font-extrabold [&_h3]:font-head [&_h3]:text-[1.125rem] [&_li]:ml-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_p]:mt-2.5 [&_p:first-child]:mt-0 [&_ul]:mt-2 [&_ul]:list-disc"
                />
              ) : (
                <PostBody
                  text={event.description}
                  className="text-[1rem] text-ink leading-[1.55] [&_a]:text-emphasis [&_a]:underline [&_h3]:mt-3.5 [&_h3]:font-extrabold [&_h3]:font-head [&_h3]:text-[1.125rem] [&_li]:ml-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_p]:mt-2.5 [&_p:first-child]:mt-0 [&_ul]:mt-2 [&_ul]:list-disc"
                />
              )}
              {/* The host's own page, as the details' last line (the owner,
                2026-10-27): text, not one more button. Its tap height hangs into
                the box's bottom padding, so the box is as deep below as above. */}
              {moreHref && moreHref !== registerHref ? (
                <a
                  href={moreHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 -mb-2.5 inline-flex min-h-11 items-center gap-1.5 font-extrabold font-head text-[0.9375rem] text-emphasis underline underline-offset-[3px]"
                >
                  More details at {siteName(moreHref)}
                  <ExternalLink className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                </a>
              ) : null}
            </section>
          ) : null}
          {account.status === 'member' ? <EventFiles eventId={event.id} /> : null}

          {/* Below the details, so they are read first (the owner,
            2026-10-27), two halves of the width, Join online under them. What Going shares
            is said in the sheet that opens once it is pressed (rsvp-sheet.tsx).

            No RSVP on an event that is over. The list stopped offering it when
            past events became lines rather than cards; this screen kept
            offering it, so the same finished evening answered two different
            ways depending on how you arrived at it. */}
          {checkInPhase === 'open' && account.status === 'member' ? (
            <CheckInCard
              eventId={event.id}
              eventTitle={event.title}
              memberId={account.userId}
              organizationId={event.organizationId}
              hostName={organization?.name ?? null}
            />
          ) : null}
          {checkInPhase === 'soon' && account.status === 'member' ? <CheckInNotYet /> : null}
          {/* Here only in the week after it closed, when a message can still be
            sent; the printed code's page says it has closed for ever after. */}
          {checkInPhase === 'over' &&
          account.status === 'member' &&
          missedCheckInHelpOpen(event) ? (
            <CheckInClosed
              eventId={event.id}
              eventTitle={event.title}
              memberId={account.userId}
              offerHelp
            />
          ) : null}
          {isPastEvent(event) ? (
            <p className="mt-5 text-[0.8125rem] text-ink2 leading-[1.45]">
              {going
                ? 'You said you were going to this.'
                : interested
                  ? 'You were interested in this.'
                  : declined
                    ? 'You said you couldn’t go.'
                    : 'This has already happened.'}
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {/* Going, Interested and Can't go (the owner, 2026-11-14), three
                across: the row the invite email has. */}
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {/* With a sign-up of the host's own, Register stands for Going
                (the owner, 2026-10-27): it marks them going here and opens
                the host's page, in one press. Taking it back is Going ✓. */}
                {registerHref && !going && !separateRegistration ? (
                  <a
                    href={registerHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      onRsvp('going');
                    }}
                    aria-describedby={registerNote}
                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-[13px] bg-action px-2 font-bold font-head text-[0.875rem] text-white transition-colors hover:bg-action-hi"
                  >
                    Register
                    <ExternalLink className="h-[15px] w-[15px] flex-none" aria-hidden="true" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onRsvp(going ? null : 'going');
                    }}
                    aria-pressed={going}
                    aria-describedby={reachesHost ? undefined : goingNote}
                    className={cn(
                      'flex min-h-11 items-center justify-center rounded-[13px] px-2 font-bold font-head text-[0.875rem] transition-colors',
                      going
                        ? CHOSEN
                        : interested || declined
                          ? UNCHOSEN
                          : 'bg-action text-white hover:bg-action-hi',
                    )}
                  >
                    {separateRegistration
                      ? going
                        ? 'Going in club ✓'
                        : 'Going in club'
                      : going
                        ? 'Going ✓'
                        : reachesHost
                          ? 'RSVP'
                          : 'Going'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onRsvp(interested ? null : 'interested');
                  }}
                  aria-pressed={interested}
                  className={cn(
                    'flex min-h-11 items-center justify-center rounded-[13px] px-2 font-bold font-head text-[0.875rem] transition-colors',
                    interested ? CHOSEN : UNCHOSEN,
                  )}
                >
                  {interested ? 'Interested ✓' : 'Interested'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDecline(!declined);
                  }}
                  aria-pressed={declined}
                  className={cn(
                    'flex min-h-11 items-center justify-center rounded-[13px] px-2 font-bold font-head text-[0.875rem] transition-colors',
                    declined ? CHOSEN : UNCHOSEN,
                  )}
                >
                  {declined ? 'Can’t go ✓' : 'Can’t go'}
                </button>
              </div>
              {meeting ? (
                <MeetingLinkButton
                  href={meeting.href}
                  service={meeting.service}
                  tone="page"
                  className="col-span-2 text-[0.875rem]"
                />
              ) : null}
              {registerHref ? (
                <p
                  id={registerNote}
                  className="col-span-2 text-[0.78125rem] text-ink2 leading-[1.45]"
                >
                  {going || separateRegistration ? (
                    <>
                      {separateRegistration
                        ? 'Going in club does not register you. '
                        : 'Not signed up with them yet? '}
                      <a
                        href={registerHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-emphasis underline underline-offset-2"
                      >
                        {`Register with ${host ?? 'the host'}`}
                      </a>
                    </>
                  ) : (
                    `Register opens ${host ?? 'the host'}'s own sign-up and marks you as going here.`
                  )}
                </p>
              ) : null}
              {/* Read from the host's own calendar, and nobody there looks at
                the list (the owner, 2026-11-04): Going is for the club. */}
              {!registerHref && !reachesHost ? (
                <p id={goingNote} className="col-span-2 text-[0.78125rem] text-ink2 leading-[1.45]">
                  {`Going lets members see you’re going. It doesn’t send ${host ?? 'the host'} an RSVP, so check with them if they need one.`}
                </p>
              ) : null}
            </div>
          )}
          {writeError ? (
            <p className="mt-3 rounded-xl bg-danger-lt px-3.5 py-2.5 text-danger-ink text-[0.7875rem]">
              {writeError}
            </p>
          ) : fromLink ? (
            <p
              role="status"
              className="mt-3 rounded-xl bg-tint px-3.5 py-2.5 text-[0.8125rem] text-ink leading-[1.45]"
            >
              {fromLink}
            </p>
          ) : null}

          {/* Where the mock puts a group chat, and now what it puts there.
            Members only: the read behind it is the viewer's own conversation
            list, and an event page is the one surface that is public. */}
          {memberId ? (
            <EventGroupCard eventId={event.id} closed={isPrivateAudience(event.audience)} />
          ) : null}
          {memberId ? (
            <ReviewsSection target={{ kind: 'event', id: event.id }} pageName={event.title} />
          ) : null}

          <AttendeeSection
            title="Going"
            attendees={goingList}
            // The tally counts everyone; this list only names members who let
            // themselves be browsed, so it can legitimately be shorter.
            total={event.goingCount}
            onOpen={(memberId) => {
              void navigate(`/peers/${memberId}`);
            }}
          />
          <AttendeeSection
            title="Interested"
            attendees={interestedList}
            total={event.interestedCount}
            onOpen={(memberId) => {
              void navigate(`/peers/${memberId}`);
            }}
          />

          {host || event.cohostIds.length > 0 || managesHosts ? (
            <>
              <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
                Hosted by
              </h2>
              {!host ? null : organization ? (
                <button
                  type="button"
                  onClick={() => {
                    void navigate(`/events/organizations/${organization.id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-[14px] border border-line bg-paper p-3.5 text-left"
                >
                  <OrganizationBadge organization={organization} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold font-head text-[0.90625rem] text-ink">
                      {organization.name}
                    </span>
                    <span className="block text-[0.78125rem] text-grey">
                      {organizationTown(organization)}
                    </span>
                  </span>
                  <ChevronRight className="h-[19px] w-[19px] flex-none text-grey" />
                </button>
              ) : (
                // A host from the feed that the club has no organization for. Not
                // a link, because there is no page to go to — pretending
                // otherwise is a dead end wearing a chevron.
                <p className="rounded-[14px] border border-line bg-paper p-3.5 text-[0.90625rem] text-ink">
                  {host}
                </p>
              )}
              <EventCohosts
                event={event}
                organizations={organizations}
                byId={organizationsById}
                manages={managesHosts}
                mine={mine.ids}
                onChanged={() => reload?.()}
              />
            </>
          ) : null}

          <EventViewsLine eventId={event.id} allowed={canSeeCheckIns} />

          <EventAudienceSection
            event={event}
            organizationName={organization?.name ?? null}
            canChange={canChange}
            canSeeCheckIns={canSeeCheckIns}
            canSetVisibility={canSetVisibility}
            adminOf={adminOf}
            onChanged={() => reload?.()}
          />

          {canChange ? <InvitationEmails eventId={event.id} /> : null}

          {canChange && !event.handAdded ? (
            <ChangeImportedEvent
              eventId={event.id}
              changed={event.adminChanged.length > 0}
              onReverted={() => {
                announce("The event is back as the organization's calendar has it.");
                reload?.();
              }}
            />
          ) : canChange ? (
            <ChangeEvent
              eventId={event.id}
              going={event.goingCount}
              repeats={event.seriesId !== null}
              onDeleted={(later) => {
                announce(
                  later ? 'This date and the later ones are deleted.' : 'The event is deleted.',
                );
                void navigate('/events', { replace: true });
              }}
            />
          ) : null}
        </div>
      </div>
      {rsvpSheet}
    </>
  );
}

/**
 * Going, Interested or Can't go once chosen: solid gold with a check, as the
 * invite page's chosen answer, so it is the one filled button of the three
 * and RSVP's navy steps back to an outline (the owner, 2026-11-17: "make the
 * chosen buttons stand out more"; grey read as switched off).
 */
const CHOSEN = 'bg-gold text-on-gold hover:bg-gold-hi';
const UNCHOSEN = 'border-[1.6px] border-emphasis text-emphasis hover:bg-tint';

/** "norcalsci.org" from its address, for "More details at". */
export function siteName(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return 'their site';
  }
}

/**
 * One roster.
 *
 * Renders nothing at all when nobody has said yes — an empty "Going" heading
 * reads as a failure to load rather than as an accurate zero.
 */
function AttendeeSection({
  title,
  attendees,
  total,
  onOpen,
}: {
  title: string;
  attendees: EventAttendee[];
  total: number;
  onOpen: (memberId: string) => void;
}) {
  if (total === 0) return null;

  return (
    <>
      <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
        {title} · {total}
      </h2>
      <AttendeeList attendees={attendees} total={total} onOpen={onOpen} />
    </>
  );
}

/**
 * Changing or deleting an event added by hand, for whoever may: an
 * administrator, or a member who speaks for its organization. A scraped event
 * never shows this — it is changed on its organization's own calendar.
 *
 * Deleting asks first, in place, and says what goes with it: the RSVPs. The
 * event's group chat stays (delete_event's header says why), so the question
 * does not claim otherwise.
 *
 * A date of a repeating event asks which (the owner, 2026-10-10, as Google
 * Calendar does): this date only, or this and every later date, which also
 * stops the series (delete_event_and_later). Changing is always this date only.
 */
function ChangeEvent({
  eventId,
  going,
  repeats,
  onDeleted,
}: {
  eventId: string;
  going: number;
  repeats: boolean;
  onDeleted: (later: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<'one' | 'later' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function confirm(later: boolean) {
    setBusy(later ? 'later' : 'one');
    setError(null);
    void (later ? deleteEventAndLater(eventId) : deleteEvent(eventId)).then((result) => {
      setBusy(null);
      if (result.ok) onDeleted(later);
      else setError(result.error ?? 'The event was not deleted.');
    });
  }

  return (
    <>
      <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
        Added in the club
      </h2>
      {asking ? (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 p-3.5">
          <p className="text-[0.875rem] text-ink leading-[1.45]">
            {repeats ? 'This event repeats. Delete which dates? ' : 'Delete this event? '}
            {going > 0
              ? `${going} member${going === 1 ? ' has' : 's have'} said they are going to this date, and will find it gone.`
              : 'Nobody has said they are going to this date yet.'}{' '}
            Its group chat, if it has one, stays.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
          <div className={`mt-3 grid gap-[9px] ${repeats ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => {
                confirm(false);
              }}
              disabled={busy !== null}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] bg-destructive-fill px-3 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
            >
              {busy === 'one' ? 'Deleting…' : repeats ? 'This date only' : 'Delete'}
            </button>
            {repeats ? (
              <button
                type="button"
                onClick={() => {
                  confirm(true);
                }}
                disabled={busy !== null}
                className="flex min-h-[44px] items-center justify-center rounded-[13px] bg-destructive-fill px-3 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
              >
                {busy === 'later' ? 'Deleting…' : 'This and all later dates'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                setError(null);
              }}
              disabled={busy !== null}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-line px-3 font-bold font-head text-[0.9375rem] text-ink"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[9px]">
          <Link
            to={`/events/${eventId}/edit`}
            className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-emphasis font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-tint"
          >
            Change
          </Link>
          <button
            type="button"
            onClick={() => {
              setAsking(true);
            }}
            className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-destructive/60 font-bold font-head text-[0.9375rem] text-destructive transition-colors hover:bg-destructive/5"
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Changing an imported event, for an administrator (20261012060000). There
 * is no Delete: the next night's import would bring it back. Revert appears
 * once something has been changed here, and puts the organization's calendar
 * version back at once.
 */
function ChangeImportedEvent({
  eventId,
  changed,
  onReverted,
}: {
  eventId: string;
  changed: boolean;
  onReverted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function revert() {
    setBusy(true);
    setError(null);
    void revertImportedEvent(eventId).then((result) => {
      setBusy(false);
      if (result.ok) {
        setAsking(false);
        onReverted();
      } else setError(result.error ?? 'The event was not reverted.');
    });
  }

  return (
    <>
      <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
        From the organization's calendar
      </h2>
      <p className="mb-2.5 text-[0.8125rem] text-ink2 leading-[1.45]">
        {changed
          ? 'An administrator has changed this event here. Those changes stay when the calendar updates.'
          : 'As an administrator you can change it here; your changes stay when the calendar updates.'}
      </p>
      {asking ? (
        <div className="rounded-[14px] border border-line bg-tint/40 p-3.5">
          <p className="text-[0.875rem] text-ink leading-[1.45]">
            Put this event back as the organization's calendar has it? The changes made here go.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-[9px]">
            <button
              type="button"
              onClick={revert}
              disabled={busy}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] bg-action px-3 font-bold font-head text-[0.9375rem] text-white disabled:opacity-40"
            >
              {busy ? 'Reverting…' : 'Revert'}
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
              Keep the changes
            </button>
          </div>
        </div>
      ) : (
        <div className={`grid gap-[9px] ${changed ? 'grid-cols-2' : 'grid-cols-1 max-w-[220px]'}`}>
          <Link
            to={`/events/${eventId}/edit`}
            className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-emphasis font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-tint"
          >
            Change
          </Link>
          {changed ? (
            <button
              type="button"
              onClick={() => {
                setAsking(true);
              }}
              className="flex min-h-[44px] items-center justify-center rounded-[13px] border-[1.6px] border-line px-2 text-center font-bold font-head text-[0.875rem] text-ink transition-colors hover:bg-tint"
            >
              Revert to the calendar
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
