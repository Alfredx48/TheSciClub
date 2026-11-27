import { Lock, QrCode, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import {
  type AudienceHint,
  type EventVisibility,
  fetchAudienceHint,
  fetchEventVisibility,
  isPrivateAudience,
  linkIsClosed,
  publicEventUrl,
} from '@/lib/event-audience';
import { askToJoinEvent, fetchMyJoinRequest } from '@/lib/event-join-requests';
import { useOrganizationFollows } from '@/lib/organization-follows';
import type { AudienceOrganization } from '@/routes/events/audience-field';
import { EventGroupCard } from '@/routes/events/event-group-card';
import { EventInviteList } from '@/routes/events/event-invite-list';
import { ShortLinkField, ShortLinkQr } from '@/routes/events/event-short-link';
import { FollowButton } from '@/routes/events/follow-button';
import { InviteesSheet } from '@/routes/events/invitees-sheet';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { VisibilitySheet } from '@/routes/events/visibility-sheet';
import type { ClubEvent, EventAudience } from '@/types/domain';

/**
 * The pieces of an event's page that come from who can see it
 * (20261022180000): what the audience is, the link to share (every event has
 * one, 20261029110000), the guest list for its organizers, and, for a member outside the audience who has the link,
 * who the event is for and nothing more.
 */

export function audienceLabel(
  audience: EventAudience,
  organizationName: string | null,
  visibility: EventVisibility | null = null,
): string {
  switch (audience) {
    case 'club':
      return 'Everyone in the club';
    case 'followers':
      return organizationName ? `Members of ${organizationName}` : 'Its members';
    case 'groups':
      return 'Members of chosen groups';
    case 'organizations': {
      const names = visibility?.organizations.map((o) => o.name) ?? [];
      return names.length > 0
        ? `Members of ${names.join(', ')}`
        : 'Members of chosen organizations';
    }
    case 'people': {
      const count = visibility?.inviteeCount;
      return count === undefined
        ? 'Invite only'
        : `Invite only · ${count === 1 ? '1 person' : `${count} people`} invited`;
    }
  }
}

const POPUP_MS = 2000;

const HEADING =
  'mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]';

/** Who can see it, the link to share it, and the organizers' guest list. */
export function EventAudienceSection({
  event,
  organizationName,
  canChange,
  canSeeCheckIns = false,
  canSetVisibility = false,
  adminOf = [],
  onChanged,
}: {
  event: ClubEvent;
  organizationName: string | null;
  canChange: boolean;
  /** The check-in QR code and who has used it. */
  canSeeCheckIns?: boolean;
  /** May change who sees it: an imported event's org admins too (20261106030000). */
  canSetVisibility?: boolean;
  /** The organizations they are an org admin of, for Members of an organization. */
  adminOf?: AudienceOrganization[];
  onChanged?: () => void;
}) {
  const announce = useAnnounce();
  const [visibility, setVisibility] = useState<EventVisibility | null>(null);
  const [changing, setChanging] = useState(false);
  const [listing, setListing] = useState(false);
  const [readAgain, setReadAgain] = useState(0);
  const readerId = useAccount().userId;
  // Invite only, with the list this reader may see: the count opens it.
  const listed = event.audience === 'people' && visibility?.invitees ? visibility : null;
  // Invite only has no link to share, only invites (the owner, 2026-11-14).
  const hidden = linkIsClosed(event.audience);
  // Which organizations, or how many invited; and for the sheet, the lists.
  useEffect(() => {
    if (readAgain < 0 || (event.audience === 'club' && !canSetVisibility)) return;
    let live = true;
    void fetchEventVisibility(event.id).then((result) => {
      if (live && result.ok) setVisibility(result.value);
    });
    return () => {
      live = false;
    };
  }, [event.id, event.audience, canSetVisibility, readAgain]);
  const [shortLink, setShortLink] = useState(event.shortLink ?? null);
  const link = publicEventUrl(event.id, shortLink);
  // Seen, as well as heard (the owner, 2026-11-01): nothing else on the screen
  // changes when a link is copied.
  const [popup, setPopup] = useState<string | null>(null);
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(() => {
      setPopup(null);
    }, POPUP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [popup]);
  const say = (words: string) => {
    setPopup(words);
    announce(`${words}.`);
  };
  return (
    <>
      {popup ? (
        // The announcement is what a screen reader hears; this would say it twice.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4"
        >
          <span className="rounded-full bg-action px-4 py-2 font-bold text-[0.875rem] text-white shadow-[0_6px_18px_rgba(10,20,35,.35)]">
            {popup}
          </span>
        </div>
      ) : null}
      <h2 className={HEADING}>Who can see it</h2>
      <div className="rounded-[14px] border border-line bg-paper p-3.5">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 font-bold text-[0.90625rem] text-ink">
            {hidden ? (
              <Lock aria-hidden="true" className="h-[14px] w-[14px] flex-none" strokeWidth={2.4} />
            ) : null}
            {listed ? (
              <span>
                Invite only ·{' '}
                <button
                  type="button"
                  onClick={() => {
                    setListing(true);
                  }}
                  className="font-bold underline underline-offset-2 hover:text-emphasis"
                >
                  {listed.inviteeCount === 1 ? '1 person' : `${listed.inviteeCount} people`} invited
                </button>
              </span>
            ) : (
              audienceLabel(event.audience, organizationName, visibility)
            )}
          </p>
          {canSetVisibility && visibility ? (
            <button
              type="button"
              onClick={() => {
                setChanging(true);
              }}
              className="-my-2 min-h-[44px] flex-none rounded-[10px] px-3 font-bold text-[0.8125rem] text-emphasis hover:bg-tint"
            >
              Change
            </button>
          ) : null}
        </div>
        {hidden ? (
          // The owner, 2026-11-14: "There should be no option for an external
          // link. There should only be an option to invite." Each invite
          // emailed from a list carries its own link (20261114020000).
          <>
            <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
              Private. Only the people invited can see it. To invite people outside the club, send
              invites from a list or a spreadsheet: each gets their own link.
            </p>
            {canChange ? <EventInviteList event={event} /> : null}
          </>
        ) : (
          <>
            {/* Every event, to invite whoever you like (the owner, 2026-10-29). */}
            <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
              Share the link to invite anyone: they see the event and can add themselves to the
              guest list. Who's going stays in the club.
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <span className="min-w-0 break-all text-[0.8125rem] text-ink2">{link}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(
                    () => {
                      say('Link copied');
                    },
                    () => {
                      say('Could not copy the link');
                    },
                  );
                }}
                className="min-h-[44px] flex-none rounded-[10px] bg-tint px-3 font-bold text-[0.8125rem] text-emphasis"
              >
                Copy link
              </button>
            </div>
            {canChange ? (
              <ShortLinkField
                eventId={event.id}
                shortLink={shortLink}
                onSaved={setShortLink}
                say={say}
              />
            ) : null}
            {shortLink ? <ShortLinkQr link={link} title={event.title} /> : null}
          </>
        )}
      </div>
      {listing && listed ? (
        <InviteesSheet
          visibility={listed}
          organizationName={organizationName}
          hasCohosts={event.cohostIds.length > 0}
          readerId={readerId}
          onClose={() => {
            setListing(false);
          }}
        />
      ) : null}
      {changing && visibility ? (
        <VisibilitySheet
          event={event}
          visibility={visibility}
          organizations={adminOf}
          onCancel={() => {
            setChanging(false);
          }}
          onSaved={() => {
            setChanging(false);
            setReadAgain((n) => n + 1);
            onChanged?.();
          }}
        />
      ) : null}
      {canChange ? (
        <Link
          to={`/events/${event.id}/guests`}
          className="mt-2.5 flex min-h-[46px] items-center justify-center gap-2 rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
        >
          <Users className="h-[17px] w-[17px]" aria-hidden="true" />
          Guest list
        </Link>
      ) : null}
      {canSeeCheckIns ? (
        <Link
          to={`/events/${event.id}/check-ins`}
          className="mt-2.5 flex min-h-[46px] items-center justify-center gap-2 rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
        >
          <QrCode className="h-[17px] w-[17px]" aria-hidden="true" />
          Check-ins and QR code
        </Link>
      ) : null}
    </>
  );
}

/**
 * For a member who opened a link to an event they cannot see: who it is for.
 * Never the title, the time or the place, and never which group. Falls back to
 * `missing` when there is no such event at all.
 */
export function OutsideTheAudience({
  eventId,
  missing,
  onFollowed,
}: {
  eventId: string;
  missing: React.ReactNode;
  onFollowed: () => void;
}) {
  const [hint, setHint] = useState<AudienceHint | null | undefined>(undefined);
  const follows = useOrganizationFollows();

  useEffect(() => {
    let cancelled = false;
    void fetchAudienceHint(eventId).then((value) => {
      if (!cancelled) setHint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (hint === undefined) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  if (hint === null) return <>{missing}</>;

  const organization = hint.organization;
  return (
    <div className="mx-auto w-full max-w-[420px] px-6 py-10 text-center">
      {hint.audience === 'people' ? (
        <>
          <Lock aria-hidden="true" className="mx-auto h-7 w-7 text-grey" />
          <h1 className="mt-3 font-extrabold font-head text-[1.25rem] text-ink">Invite only</h1>
          <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.5]">
            This event is private, for the people its organizer invited.
          </p>
          <AskToJoin eventId={eventId} onInvited={onFollowed} />
        </>
      ) : hint.audience === 'organizations' && !organization ? (
        <>
          <Lock aria-hidden="true" className="mx-auto h-7 w-7 text-grey" />
          <h1 className="mt-3 font-extrabold font-head text-[1.25rem] text-ink">Members only</h1>
          <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.5]">
            This event is private, for the members of the organizations hosting it.
          </p>
        </>
      ) : (hint.audience === 'followers' || hint.audience === 'organizations') && organization ? (
        <>
          <OrganizationBadge organization={organization} size="lg" className="mx-auto" />
          <h1 className="mt-3 font-extrabold font-head text-[1.25rem] text-ink">
            For {organization.name}'s members
          </h1>
          <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.5]">
            This event is for people who have joined {organization.name}. Join to see it and say
            you're going.
          </p>
          <FollowButton
            following={follows.following.has(organization.id)}
            requested={follows.requested.has(organization.id)}
            onToggle={() => {
              follows.toggle(organization.id);
              // Seen once the follow is saved: the page reads the event again.
              window.setTimeout(onFollowed, 800);
            }}
            className="mx-auto mt-4"
          />
        </>
      ) : (
        <>
          <h1 className="font-extrabold font-head text-[1.25rem] text-ink">
            For a group you're not in
          </h1>
          <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.5]">
            This event is for the members of a group chat. Ask whoever shared it to add you.
          </p>
        </>
      )}
      {isPrivateAudience(hint.audience) ? null : <EventGroupCard eventId={eventId} />}
    </div>
  );
}

/**
 * Ask to join, on an invite-only event's page for a member outside it
 * (20261127120000; the owner, 2026-11-27). Its organizers decide; a no is
 * never said, so once asked it reads Asked either way.
 */
function AskToJoin({ eventId, onInvited }: { eventId: string; onInvited: () => void }) {
  const announce = useAnnounce();
  const [asked, setAsked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchMyJoinRequest(eventId).then((value) => {
      if (live) setAsked(value);
    });
    return () => {
      live = false;
    };
  }, [eventId]);

  function ask() {
    setBusy(true);
    setError(null);
    void askToJoinEvent(eventId).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.value === 'invited') {
        onInvited();
        return;
      }
      setAsked(true);
      announce('Asked. Its organizer will decide.');
    });
  }

  if (asked === null) return null;
  return (
    <div className="mt-4">
      {asked ? (
        <p
          role="status"
          className="rounded-[13px] border border-line bg-paper px-3.5 py-3 text-[0.875rem] text-ink2 leading-[1.5]"
        >
          <span className="font-bold text-ink">Asked.</span> If its organizer says yes, you’ll be
          invited and told.
        </p>
      ) : (
        <>
          <p className="text-[0.875rem] text-ink2 leading-[1.5]">
            You can ask to join. Its organizer sees your name and decides.
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={busy}
            className="mx-auto mt-3 flex min-h-[48px] w-full max-w-[280px] items-center justify-center rounded-[13px] bg-action px-4 font-bold font-head text-[0.9375rem] text-white hover:bg-action-hi disabled:opacity-50"
          >
            {busy ? 'Asking…' : 'Ask to join'}
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
