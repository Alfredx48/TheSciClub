import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { OwnBack } from '@/components/back-line';
import { MemberAvatar } from '@/components/member-avatar';
import { useAccount } from '@/lib/account';
import { useEvents } from '@/lib/events';
import { useOrganizationGrants } from '@/lib/grants';
import { useOrganizationFollows } from '@/lib/organization-follows';
import {
  fetchOrganizationMembers,
  JOINED_VIA_LABEL,
  type OrganizationMember,
  useMyDenial,
  useOrganizationChat,
  useOrganizationMemberCount,
} from '@/lib/organization-members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { averageRating, type StarChoice, useReviews } from '@/lib/reviews';
import { backLabel, backToEvents } from '@/routes/events/back';
import { isPastEvent } from '@/routes/events/filters';
import { FollowButton } from '@/routes/events/follow-button';
import { dateTileParts } from '@/routes/events/format';
import { OrganizationAddMembers } from '@/routes/events/organization-add-members';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { OrganizationGrants } from '@/routes/events/organization-grants';
import { OrganizationJoinSetting } from '@/routes/events/organization-join-setting';
import { OrganizationMemberRemove } from '@/routes/events/organization-member-remove';
import { organizationTown, placesOf } from '@/routes/events/organization-places';
import { OrganizationReviewSetting } from '@/routes/events/organization-review-setting';
import { OrganizationReviews } from '@/routes/events/organization-reviews';
import { OrganizationRsvpSetting } from '@/routes/events/organization-rsvp-setting';
import { OrganizationSummarySetting } from '@/routes/events/organization-summary-setting';
import { PlaceContact } from '@/routes/events/place-contact';
import { EventDescription } from '@/routes/events/rich-text';
import { ShareOrganizationButton } from '@/routes/events/share-event';
import { ReviewsList } from '@/routes/reviews/reviews-section';
import { Stars } from '@/routes/reviews/stars';
import type { ClubEvent } from '@/types/domain';

const UPCOMING_SHOWN = 5;
/** Past events: the latest 3 (the owner, 2026-11-17), then 10 more, then all. */
const PAST_FIRST = 3;
const PAST_MORE = 10;

/**
 * One organization, from `orgPage()` in the mock: who they are, the members who
 * name them, and what they have coming up.
 *
 * Public in the schema but reached from inside the shell here, so the member
 * list is a normal read of `browse_members`. If this page is ever also served
 * to somebody with no account, that section is the part that has to go — the
 * events and the description are already public, the people are not.
 */
export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const back = backToEvents(location);
  const { byId, loading } = useOrganizations();
  const follows = useOrganizationFollows();
  const { events } = useEvents({ organizationId: id ?? '00000000-0000-0000-0000-000000000000' });
  const { grants } = useOrganizationGrants(id);
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;
  const [additions, setAdditions] = useState(0);
  const [allUpcoming, setAllUpcoming] = useState(false);
  const [pastShown, setPastShown] = useState(PAST_FIRST);
  // Read here, as the rating shows under the name too (the owner, 2026-11-16).
  const reviews = useReviews({ kind: 'organization', id: id ?? '' });
  const [stars, setStars] = useState<StarChoice>(null);
  const [reviewsRead, setReviewsRead] = useState(0);
  const count = useOrganizationMemberCount(id, additions);
  const denial = useMyDenial(id, memberId);
  const chat = useOrganizationChat(id, memberId);
  const mine = useMyOrganizations(memberId);
  const seesMembers =
    account.status === 'member' && (account.isAdmin || (id !== undefined && mine.ids.has(id)));
  const [roster, setRoster] = useState<OrganizationMember[] | null>(null);

  const readRoster = useCallback(() => {
    if (!id) return;
    void fetchOrganizationMembers(id).then((result) => {
      if (result.ok) setRoster(result.value);
    });
  }, [id]);
  const isMember = id !== undefined && follows.following.has(id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: joining or leaving changes the list.
  useEffect(readRoster, [readRoster, isMember]);

  const membersChanged = useCallback(() => {
    readRoster();
    setAdditions((n) => n + 1);
  }, [readRoster]);
  const everythingChanged = useCallback(() => {
    membersChanged();
    setReviewsRead((n) => n + 1);
  }, [membersChanged]);

  const organization = id ? (byId.get(id) ?? null) : null;

  if (loading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  if (!organization) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-[0.875rem] text-ink2">No such organization.</p>
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
    );
  }

  // The next few, so the rest of the page is not a long scroll away (the owner,
  // 2026-11-01).
  const upcoming = events
    .filter(
      (event) =>
        (event.organizationId === organization.id || event.cohostIds.includes(organization.id)) &&
        !isPastEvent(event),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const hiddenUpcoming = allUpcoming ? 0 : Math.max(0, upcoming.length - UPCOMING_SHOWN);
  const past = events
    .filter(
      (event) =>
        (event.organizationId === organization.id || event.cohostIds.includes(organization.id)) &&
        isPastEvent(event),
    )
    .sort((a, b) => b.startTime.localeCompare(a.startTime));
  const hiddenPast = Math.max(0, past.length - pastShown);
  const rated = averageRating(reviews.reviews);
  const toReviews = () => {
    const section = document.getElementById('org-reviews');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    section?.focus({ preventScroll: true });
  };
  const openEvent = (eventId: string) => {
    void navigate(`/events/${eventId}`);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="bg-plate px-4 pt-2 pb-5 text-white">
        <div className="mx-auto w-full max-w-[var(--events-measure)]">
          {/* Share across from Back, as on an event (the owner, 2026-11-03). */}
          <div className="flex items-center justify-between gap-2">
            <OwnBack to={back} label={backLabel(location)} spacer>
              <button
                type="button"
                onClick={() => {
                  void navigate(back);
                }}
                className="block pb-3 text-[#B9CADF] text-[0.875rem]"
              >
                ← {backLabel(location)}
              </button>
            </OwnBack>
            <ShareOrganizationButton id={organization.id} name={organization.name} />
          </div>

          <div className="flex items-center gap-[13px]">
            <OrganizationBadge organization={organization} size="lg" />
            <span>
              <span className="block font-extrabold font-head text-[1.3125rem] leading-[1.2] tracking-[-0.01em]">
                {organization.name}
              </span>
              <span className="mt-[3px] block text-[#B9CADF] text-[0.8125rem]">
                {[
                  organizationTown(organization),
                  placesOf(organization).length > 1
                    ? `${placesOf(organization).length} locations`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </div>

          {/* Under the name rather than beside it. At 430px a button on the
              same row as a 21px organization name leaves the name about nine
              characters, and "Christopher & Dana Reeve Foundation" is one of
              six rows here. */}
          {denial === null ? (
            <FollowButton
              onNavy
              following={follows.following.has(organization.id)}
              requested={follows.requested.has(organization.id)}
              onToggle={() => {
                follows.toggle(organization.id);
              }}
              className="mt-3"
            />
          ) : null}

          {count !== null ? (
            <p className="mt-2.5 text-[#DDE7F3] text-[0.8125rem]">
              <b className="text-white">{count}</b> {count === 1 ? 'member' : 'members'}
            </p>
          ) : null}

          {memberId && rated.count > 0 ? (
            <div className="mt-2.5">
              <button
                type="button"
                onClick={toReviews}
                className="inline-flex min-h-[40px] items-center gap-2 text-[0.875rem] text-white underline-offset-2 hover:underline"
              >
                <Stars value={rated.average} />
                <span>
                  <b>{rated.average}</b> · {rated.count} {rated.count === 1 ? 'review' : 'reviews'}
                </span>
              </button>
            </div>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {organization.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-plate-chip px-2.5 py-[5px] font-semibold text-[#DDE7F3] text-[0.7375rem]"
              >
                {tag}
              </span>
            ))}
            {organization.canInvite ? (
              <span className="rounded-full bg-[#3A2F12] px-2.5 py-[5px] font-semibold text-gold-hi text-[0.7375rem]">
                Can issue invites
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[var(--events-measure)] px-4 pb-5">
        {/* The small Markdown events use: paragraphs, bold, lists, links. */}
        <EventDescription
          html=""
          text={organization.description}
          className="mt-2.5 text-[0.8875rem] text-ink leading-[1.52] [&_a]:font-semibold [&_a]:text-emphasis [&_a]:underline [&_a]:[overflow-wrap:anywhere] [&_li]:ml-5 [&_li]:mt-1 [&_ol]:mt-2 [&_ol]:list-decimal [&_p:first-child]:mt-0 [&_p]:mt-2.5 [&_strong]:font-bold [&_ul]:mt-2 [&_ul]:list-disc"
        />

        {(organization.places ?? []).some((place) => Boolean(place.note ?? place.url)) ? (
          <section aria-labelledby="org-locations-heading" className="mt-5">
            <h2
              id="org-locations-heading"
              className="mb-2 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
            >
              Locations and who to contact
            </h2>
            <div className="space-y-2">
              {(organization.places ?? [])
                .filter((place) => Boolean(place.note ?? place.url))
                .map((place) => (
                  <PlaceContact key={place.id} place={place} />
                ))}
            </div>
          </section>
        ) : null}

        <OrganizationGrants
          grants={grants}
          organizationName={organization.name}
          following={follows.following.has(organization.id)}
        />

        {upcoming.length > 0 ? (
          <>
            <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
              Upcoming
            </h2>
            {upcoming.slice(0, upcoming.length - hiddenUpcoming).map((event) => (
              <EventRow key={event.id} event={event} onOpen={openEvent} />
            ))}
            {hiddenUpcoming > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAllUpcoming(true);
                }}
                className="min-h-[44px] w-full rounded-[14px] bg-tint px-3.5 font-bold text-[0.875rem] text-emphasis hover:bg-line"
              >
                {hiddenUpcoming} more
              </button>
            ) : null}
          </>
        ) : null}

        {past.length > 0 ? (
          <section aria-labelledby="org-past-heading">
            <h2
              id="org-past-heading"
              className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
            >
              Past events
            </h2>
            {past.slice(0, pastShown).map((event) => (
              <EventRow key={event.id} event={event} onOpen={openEvent} withYear />
            ))}
            {hiddenPast > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setPastShown(
                    pastShown === PAST_FIRST ? PAST_FIRST + PAST_MORE : Number.POSITIVE_INFINITY,
                  );
                }}
                className="min-h-[44px] w-full rounded-[14px] bg-tint px-3.5 font-bold text-[0.875rem] text-emphasis hover:bg-line"
              >
                {pastShown === PAST_FIRST && hiddenPast > PAST_MORE
                  ? `Show ${PAST_MORE} more`
                  : `Show all ${past.length} past events`}
              </button>
            ) : null}
          </section>
        ) : null}

        {/* Below the events (the owner, 2026-11-16). */}
        {memberId ? (
          <ReviewsList
            id="org-reviews"
            target={{ kind: 'organization', id: organization.id }}
            pageName={organization.name}
            state={reviews}
            stars={stars}
            onStars={setStars}
          />
        ) : null}

        {denial !== null ? (
          <div role="status" className="mt-4 rounded-[14px] border border-line bg-paper p-3.5">
            <p className="font-bold text-[0.9375rem] text-ink">
              {organization.name} declined your membership
            </p>
            <p className="mt-1 text-[0.875rem] text-ink2 leading-[1.5]">{denial}</p>
          </div>
        ) : null}

        {chat ? (
          <Link
            to={`/chat/t/${chat}`}
            className="mt-4 flex min-h-[46px] items-center justify-center rounded-[13px] border-[1.6px] border-emphasis bg-paper font-bold font-head text-[0.875rem] text-emphasis"
          >
            Members' group chat
          </Link>
        ) : null}

        {seesMembers ? (
          <>
            <OrganizationSummarySetting
              organizationId={organization.id}
              summary={organization.summary ?? null}
            />
            <OrganizationJoinSetting
              organizationId={organization.id}
              needed={organization.joinsNeedApproval === true}
              onChanged={everythingChanged}
            />
            <OrganizationRsvpSetting
              organizationId={organization.id}
              collects={organization.collectsRsvps === true}
            />
            <OrganizationReviewSetting
              organizationId={organization.id}
              allowed={organization.anonymousReviews !== false}
            />
            <OrganizationReviews
              key={reviewsRead}
              organizationId={organization.id}
              onChanged={membersChanged}
            />
          </>
        ) : null}

        {roster && roster.length > 0 ? (
          <>
            <h2 className="mt-5 mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]">
              Members
            </h2>
            <ul className="rounded-[14px] border border-line bg-paper px-3.5">
              {roster.map((member) => (
                <li key={member.id} className="border-line border-b last:border-b-0">
                  <Link
                    to={`/peers/${member.id}`}
                    className="flex items-center gap-2.5 pt-2.5 pb-1"
                  >
                    <MemberAvatar
                      id={member.id}
                      displayName={member.displayName}
                      photoPath={member.photoPath}
                      photoAlt={member.photoAlt}
                    />
                    <span className="min-w-0">
                      <span className="block font-bold text-[0.9375rem] text-ink">
                        {member.displayName}
                      </span>
                      {member.joinedVia ? (
                        <span className="block text-[0.78125rem] text-grey">
                          {JOINED_VIA_LABEL[member.joinedVia]}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                  {seesMembers && member.id !== memberId && member.joinedVia !== 'org_admin' ? (
                    <OrganizationMemberRemove
                      organizationId={organization.id}
                      member={member}
                      onRemoved={everythingChanged}
                    />
                  ) : (
                    <div className="h-1.5" />
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {seesMembers ? (
          <OrganizationAddMembers
            organizationId={organization.id}
            exclude={new Set(roster?.map((member) => member.id))}
            onAdded={everythingChanged}
          />
        ) : null}

        {organization.canInvite ? (
          <p className="mt-5 rounded-r-[11px] border-gold border-l-[3px] bg-gold-lt px-3.5 py-3 text-gold-ink text-[0.7875rem] leading-[1.5]">
            {organization.name} can invite people to the club by email.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EventRow({
  event,
  onOpen,
  withYear = false,
}: {
  event: ClubEvent;
  onOpen: (id: string) => void;
  /** A past one says its year, as the tile does not. */
  withYear?: boolean;
}) {
  const tile = dateTileParts(event.startTime, event.timezone);
  const year = withYear ? new Date(event.startTime).getFullYear().toString() : null;
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(event.id);
      }}
      className="mb-[11px] flex w-full items-center gap-3 rounded-[14px] border border-line bg-paper p-3.5 text-left"
    >
      <span className="block w-[46px] flex-none rounded-[12px] bg-tint py-1.5 text-center">
        <span className="block font-extrabold font-head text-[1.1875rem] text-emphasis leading-[1.15]">
          {tile.day}
        </span>
        <span className="block font-extrabold text-[0.625rem] text-ink2 tracking-[0.09em]">
          {tile.mon}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold font-head text-[0.90625rem] text-ink leading-[1.25]">
          {event.title}
        </span>
        <span className="block text-[0.78125rem] text-grey">
          {[year, [event.city, event.city ? event.state : null].filter(Boolean).join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <ChevronRight className="h-[19px] w-[19px] flex-none text-grey" />
    </button>
  );
}
