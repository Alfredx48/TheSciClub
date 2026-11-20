import { ChevronRight, LogOut } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { InstallSettings } from '@/components/install-nudge';
import { type PageTab, PageTabs, TabPanel, useTabParam } from '@/components/page-tabs';
import { signOut, useAccount } from '@/lib/account';
import { EMAIL_RETURN_PARAM, useSignInDetails } from '@/lib/account-email';
import { APPLE_RETURN_PARAM } from '@/lib/apple-sign-in';
import { useChatRooms } from '@/lib/chat/rooms';
import { useIAmPartner, useICanConnect } from '@/lib/club-partners';
import { describeThrown } from '@/lib/describe-error';
import { platformWords, surface } from '@/lib/device-check';
import { isEventOver } from '@/lib/event-over';
import { useViewerEvents } from '@/lib/events';
import { GOOGLE_RETURN_PARAM } from '@/lib/google-sign-in';
import { useInvitePermissions } from '@/lib/invite-permissions';
import { useKeptRead } from '@/lib/kept-reads';
import { useOwnMember } from '@/lib/members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { isNative } from '@/lib/standalone';
import { appFeedbackRoom } from '@/routes/home/feedback-card';
import { MENTOR_ALLOWANCE } from '@/routes/invites/mentor-invites';
import { AddEmailBanner } from '@/routes/me/add-email-banner';
import { BlockedMembers } from '@/routes/me/blocked-members';
import { ConfirmEmailBanner } from '@/routes/me/confirm-email-banner';
import { DebugMode } from '@/routes/me/debug-mode';
import { DeckVisibility } from '@/routes/me/deck-visibility';
import { DeleteAccount } from '@/routes/me/delete-account';
import { DisplaySummary } from '@/routes/me/display-summary';
import { MeHero } from '@/routes/me/hero';
import { MapVisibility } from '@/routes/me/map-visibility';
import { NotificationSettings } from '@/routes/me/notification-settings';
import { MyOrganizations } from '@/routes/me/organizations';
import { ProfessionField } from '@/routes/me/profession-field';
import { SignInSection } from '@/routes/me/sign-in-section';
import { StandingCard } from '@/routes/me/standing';
import { loadMyStrikes, type MyStrike } from '@/routes/me/standing-api';
import { MeStats } from '@/routes/me/stats';
import { loadDetails, type MemberDetails } from '@/routes/profile/details-api';
import { loadAnswers } from '@/routes/profile/profile-api';
import { nextStep, profilePercent, stepAction, stepHref } from '@/routes/profile/progress';
import type { Answers } from '@/routes/profile/questions';
import type { RsvpStatus } from '@/types/domain';

/**
 * Me in three tabs: Profile (what the club knows about you, what you can do in
 * it, and Sign out), Settings (this device), Account (how you sign in, and
 * deleting the account).
 *
 * One scroll held all three and ran past two and a half phone screens, so
 * Sign out and Display were found by scrolling past everything else. Most
 * members use the club on a phone, so each part is now one tap from the top.
 */
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 font-extrabold font-head text-[1rem] text-ink">
      {children}
    </h2>
  );
}

const LEGAL_LINKS = [
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service'],
  ['/delete-account', 'Deleting your account'],
] as const;

const ME_TAB_VALUES = ['profile', 'settings', 'account'] as const;
type MeTab = (typeof ME_TAB_VALUES)[number];
const ME_TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'settings', label: 'Settings' },
  { value: 'account', label: 'Account' },
] as const satisfies readonly PageTab<MeTab>[];

function ProfileLink({
  to,
  title,
  description,
  percent,
  state,
}: {
  to: string;
  title: string;
  description?: string;
  percent?: number | null;
  state?: { from: string };
}) {
  const descriptionId = useId();
  return (
    <Link
      aria-label={title}
      aria-describedby={description ? descriptionId : undefined}
      to={to}
      state={state}
      className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-line bg-paper p-3.5 transition-colors hover:bg-tint"
    >
      {percent !== undefined && percent !== null && percent < 100 ? (
        <ProgressRing percent={percent} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold font-head text-[0.96875rem] text-ink">{title}</span>
        {description ? (
          <span id={descriptionId} className="mt-1 block text-[0.8125rem] text-ink2 leading-[1.5]">
            {description}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden="true" className="h-5 w-5 flex-none text-emphasis" />
    </Link>
  );
}
/**
 * The profile card while it is unfinished (the owner, 2026-11-15): the same
 * card, saying the next step and opening it, with Edit profile for the list.
 * The title is stretched over the card, so the card is one target and Edit
 * profile a second, separate one.
 */
function ProfileNextCard({ to, next, percent }: { to: string; next: string; percent: number }) {
  const descriptionId = useId();
  return (
    <div className="relative flex min-h-[64px] items-center gap-3 rounded-[14px] border border-line bg-paper p-3.5 transition-colors hover:bg-tint">
      <ProgressRing percent={percent} />
      <span className="min-w-0 flex-1">
        <Link
          to={to}
          aria-describedby={descriptionId}
          className="block font-extrabold font-head text-[0.96875rem] text-ink after:absolute after:inset-0 after:rounded-[14px]"
        >
          Complete your profile
        </Link>
        <span id={descriptionId} className="mt-1 block text-[0.8125rem] text-ink2 leading-[1.5]">
          Next: {next}
        </span>
        <Link
          to="/profile/answers"
          data-target="small"
          className="relative z-10 mt-1.5 inline-block font-semibold text-[0.8125rem] text-emphasis underline decoration-line underline-offset-2 hover:decoration-emphasis"
        >
          Edit profile
        </Link>
      </span>
      <ChevronRight aria-hidden="true" className="h-5 w-5 flex-none text-emphasis" />
    </div>
  );
}

/** A ring rather than a bar: it sits beside a line of text, not under one. */
function ProgressRing({ percent }: { percent: number }) {
  // r and the stroke decide how much room is left *inside* the ring, which is
  // the number the label has to fit — not the width of the box. A thinner
  // stroke at a wider radius buys that room without a bigger circle.
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  return (
    // Sized in `em` off its own label, so the circle grows with the number
    // inside it — and sized against the *interior* of the circle rather than
    // the box around it, which is the mistake that left this broken after it
    // was called fixed. At 3.85em the box was 46px and the label "100%" was
    // 36px, so it "fitted"; but r=18 with a 4-unit stroke leaves 34px of
    // interior, and 36 into 34 does not go. It clipped to "00%" at every text
    // size, for the one member who had finished their profile.
    //
    // 4.7em with a thinner stroke leaves ~42px of interior against a 36px
    // label. Measured, not eyeballed, at both text sizes.
    <span className="relative grid h-[4.7em] w-[4.7em] flex-none place-items-center text-[0.75rem]">
      <svg
        viewBox="0 0 44 44"
        className="-rotate-90 absolute h-[4.7em] w-[4.7em]"
        aria-hidden="true"
      >
        <circle cx="22" cy="22" r={radius} fill="none" stroke="var(--tint)" strokeWidth="3.4" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="var(--emphasis)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <span className="relative font-extrabold font-head text-emphasis">{percent}%</span>
    </span>
  );
}

export default function MePage() {
  const { userId, displayName, isAdmin } = useAccount();
  const { member, invitedBy } = useOwnMember(userId);
  const invitePermissions = useInvitePermissions(userId);
  const viewer = useViewerEvents(userId);
  // Google sends a member back to /me?google=linked, and the answer is shown
  // where the button was. That parameter is not changed to add a tab: the
  // return address is on Supabase's allowed list, as written.
  const [params] = useSearchParams();
  const [initialTab] = useState<MeTab | undefined>(() =>
    params.has(GOOGLE_RETURN_PARAM) ||
    params.has(APPLE_RETURN_PARAM) ||
    params.has(EMAIL_RETURN_PARAM)
      ? 'account'
      : undefined,
  );
  const [tab, setTab] = useTabParam(ME_TAB_VALUES, 'profile', initialTab);
  const signIn = useSignInDetails();
  // The hero is read once; a username changed on Account is shown at once.
  const [changedUsername, setChangedUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until both load, so the ring does not flash 0% at somebody whose
  // profile is finished.
  const [survey, setSurvey] = useState<{ answers: Answers; declined: Set<string> } | null>(null);
  const [details, setDetails] = useState<MemberDetails | null>(null);
  // Null until the details load, so the switch is not drawn in the wrong
  // position for a moment and then corrected under the reader's eye.
  const [showInBrowse, setShowInBrowse] = useState<boolean | null>(null);
  const [showOnMap, setShowOnMap] = useState<boolean | null>(null);
  // Null until they arrive, so the card does not say "Good standing" for a
  // moment to somebody who is on two and then correct itself.
  const [strikes, setStrikes] = useState<MyStrike[] | null>(null);
  const [afterPause, setAfterPause] = useState(false);

  // What the member has coming up, not what they have ever said yes to. These
  // two numbers are the whole of the row, and a count that keeps climbing as
  // events go by stops answering "what have I got on" — which is the only
  // question somebody reads them for. An RSVP whose date did not come back is
  // not counted: a number that guesses is worse than one that waits.
  const countUpcoming = (want: RsvpStatus) =>
    [...viewer.rsvps.entries()].filter(([eventId, status]) => {
      if (status !== want) return false;
      const when = viewer.whens.get(eventId);
      return when !== undefined && !isEventOver(when);
    }).length;

  const going = countUpcoming('going');
  const interested = countUpcoming('interested');

  // The other half of the same question. "I'm going" is future tense and now
  // holds only what is ahead, so what a member has already been to needs a door
  // of its own, and this is where the rest of what the club knows about them
  // already lives.
  const beenTo = [...viewer.rsvps.entries()].filter(([eventId, status]) => {
    if (status !== 'going') return false;
    const when = viewer.whens.get(eventId);
    return when !== undefined && isEventOver(when);
  }).length;

  const strikesKept = useKeptRead();
  // The answers and details come from the row the door shares (lib/own-row.ts).
  useEffect(() => {
    void loadAnswers().then((result) => {
      // With the declines, so "rather not say" counts towards the ring the way
      // an answer does. Without them somebody who has decided is shown an
      // unfinished profile for ever — see 20260917030000.
      if (result.ok) setSurvey({ answers: result.answers, declined: result.declined });
    });
    if (userId && !strikesKept.fresh(userId)) {
      const landed = strikesKept.start(userId);
      void loadMyStrikes(userId).then((result) => {
        if (!result.ok) return;
        setStrikes(result.strikes);
        setAfterPause(result.afterPause);
        landed();
      });
    }
    void loadDetails().then((result) => {
      if (result.ok) {
        setDetails(result.details);
        setShowInBrowse(result.details.showInBrowse);
        setShowOnMap(result.details.showOnMap);
      }
    });
  }, [userId, strikesKept]);

  // One card for the details and the survey: their average, once both load.
  const profileDone =
    survey && details ? profilePercent(details, survey.answers, survey.declined) : null;
  const next = survey && details ? nextStep(details, survey.answers, survey.declined) : null;

  const feedbackRoom = appFeedbackRoom(useChatRooms().rooms);
  // An org admin makes QR codes for their organization (20261028960000).
  const orgAdmin = useMyOrganizations(userId).ids.size > 0;
  const partner = useIAmPartner(userId) === true;
  const canConnect = useICanConnect(userId) === true;
  const hasClubTools =
    isAdmin ||
    orgAdmin ||
    partner ||
    member?.type === 'organization' ||
    invitePermissions.canInvite ||
    Boolean(invitePermissions.error);

  function leave() {
    setBusy(true);
    setError(null);
    // No navigation here: useAccount is subscribed to auth changes, so the
    // shell's guard notices and sends us to the welcome screen on its own.
    signOut()
      .then((result) => {
        if (!result.ok) setError(result.error ?? 'Could not sign out.');
      })
      .catch((e: unknown) => {
        setError(describeThrown(e, 'Could not sign out.'));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {member ? (
        <MeHero member={changedUsername ? { ...member, username: changedUsername } : member} />
      ) : (
        <header className="relative flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
          <h1 className="font-extrabold font-display text-[1.5625rem] text-ink tracking-[-0.01em]">
            Me
          </h1>
          <p className="mt-0.5 text-[0.78125rem] text-grey">Signed in as {displayName ?? '—'}</p>
        </header>
      )}

      {/* Above the tabs, so it is seen on whichever one Me opens on. */}
      <AddEmailBanner state={signIn.state} reload={signIn.reload} />
      <ConfirmEmailBanner />

      <PageTabs
        id="me"
        label="Me"
        fill
        tabs={ME_TABS}
        value={tab}
        onChange={setTab}
        measure="max-w-[var(--me-measure)]"
      />

      <div className="mx-auto w-full max-w-[var(--me-measure)] px-4 pt-5 pb-8">
        {tab === 'profile' ? (
          <TabPanel id="me" value="profile">
            <MeStats going={going} interested={interested} beenTo={beenTo} />
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
              <section aria-labelledby="me-profile-heading" className="min-w-0">
                <SectionHeading id="me-profile-heading">Your profile</SectionHeading>
                <div className="space-y-2.5">
                  {next && profileDone !== null ? (
                    <ProfileNextCard
                      to={stepHref(next, true)}
                      next={stepAction(next)}
                      percent={profileDone}
                    />
                  ) : (
                    <ProfileLink
                      to="/profile/answers"
                      title={profileDone === 100 ? 'Profile complete' : 'Complete your profile'}
                      description="Your name, photo, injury, location, interests and experience."
                      percent={profileDone}
                    />
                  )}
                  <ProfileLink
                    to="/me/posts"
                    title="My posts"
                    description="Questions and posts you started, by type and room."
                  />
                  <ProfileLink
                    to="/me/saved"
                    title="Saved"
                    description="Posts and replies you saved. Only you can see them."
                  />
                  {userId ? (
                    <ProfileLink
                      to={`/peers/${userId}`}
                      state={{ from: 'me' }}
                      title="My profile view"
                      description="See how your profile looks to other members."
                    />
                  ) : null}
                </div>
                {partner ? <ProfessionField /> : null}
                {userId && showInBrowse !== null ? (
                  <DeckVisibility
                    userId={userId}
                    showInBrowse={showInBrowse}
                    onChange={setShowInBrowse}
                  />
                ) : null}
                {userId && showOnMap !== null ? (
                  <MapVisibility userId={userId} showOnMap={showOnMap} onChange={setShowOnMap} />
                ) : null}
                {userId ? <MyOrganizations /> : null}
              </section>
              <div className="min-w-0 space-y-6">
                {hasClubTools ? (
                  <section aria-labelledby="me-club-heading">
                    <SectionHeading id="me-club-heading">Club tools</SectionHeading>
                    <div className="space-y-2.5">
                      {isAdmin ? (
                        <ProfileLink
                          to="/admin"
                          title="Admin"
                          description="Members, invites, organizations and moderation."
                        />
                      ) : null}
                      {canConnect ? (
                        <ProfileLink
                          to="/stats"
                          title="Stats & controls"
                          description="Your organization's numbers, your people, and connecting members."
                        />
                      ) : null}
                      {isAdmin || orgAdmin || partner ? (
                        <ProfileLink
                          to="/me/qr"
                          title="Create QR code or invite link"
                          description={
                            isAdmin
                              ? 'A code or link: people who scan it and join are invited by you.'
                              : 'A code or link your people can join with, until it expires.'
                          }
                        />
                      ) : null}
                      {member?.type === 'organization' ? (
                        <ProfileLink
                          to="/organizations/manage"
                          title="Manage your organizations"
                          description="Update the organizations linked to your account."
                        />
                      ) : null}
                      {invitePermissions.canInvite ? (
                        <ProfileLink
                          to="/invites"
                          title="Invite new members"
                          description={
                            invitePermissions.unlimited
                              ? 'You can invite people without a limit.'
                              : `As a mentor you can invite ${MENTOR_ALLOWANCE} people by email.`
                          }
                        />
                      ) : null}
                      {invitePermissions.error ? (
                        <div>
                          <p role="alert" className="text-destructive">
                            {invitePermissions.error}
                          </p>
                          <button
                            type="button"
                            className="min-h-[44px] text-emphasis underline"
                            onClick={invitePermissions.reload}
                          >
                            Retry invite permissions
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {/* The App Feedback room (the owner, 2026-10-28; feedback-card.tsx). */}
                {feedbackRoom ? (
                  <section aria-labelledby="me-feedback-heading">
                    <SectionHeading id="me-feedback-heading">Feedback</SectionHeading>
                    <ProfileLink
                      to={`/chat/rooms/${feedbackRoom.id}/new`}
                      state={{ from: 'me' }}
                      title="Send app feedback"
                      description="What works, what doesn't, what you'd like. It's posted in the App Feedback room, with a screenshot if you add one."
                    />
                  </section>
                ) : null}
                <section aria-labelledby="me-standing-heading">
                  <SectionHeading id="me-standing-heading">Standing</SectionHeading>
                  <StandingCard invitedBy={invitedBy} strikes={strikes} afterPause={afterPause} />
                </section>
              </div>
            </div>
            {/* On the tab Me opens on, at the owner's word: signing out is
                done in a hurry, on a shared or borrowed phone, and should not
                wait on finding the right tab. Deleting stays on Account. */}
            {error ? (
              <p role="alert" className="mt-6 text-[0.8125rem] text-destructive leading-[1.45]">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={leave}
              disabled={busy}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[13px] border border-line bg-paper font-bold font-head text-[0.9375rem] text-emphasis disabled:opacity-50 lg:mx-auto lg:max-w-[22rem]"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </TabPanel>
        ) : null}

        {tab === 'settings' ? (
          <TabPanel id="me" value="settings">
            <p className="text-[0.875rem] text-ink2 leading-[1.5]">
              {isNative()
                ? 'Display applies to this phone only.'
                : 'Display, notifications and installing apply to this phone or computer only.'}
            </p>
            {/* So somebody can tell which copy of the app they have. */}
            {import.meta.env.VITE_APP_BUILT ? (
              <p className="mt-1 text-[0.75rem] text-grey">
                Version{' '}
                {new Date(`${import.meta.env.VITE_APP_BUILT}Z`).toLocaleString('en-US', {
                  timeZone: 'America/Los_Angeles',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
                {` · ${platformWords(surface(), navigator.userAgent, navigator.maxTouchPoints)}`}
              </p>
            ) : null}
            {/* Display first: it is what somebody who finds the club hard to
                read comes here for. Its controls open in the Display sheet. */}
            <div className="grid items-start gap-x-6 lg:grid-cols-2 [&>section:first-child]:mt-4 lg:[&>section]:mt-4">
              <DisplaySummary />
              <NotificationSettings
                userId={userId}
                isMentor={member?.type === 'mentor'}
                isAdmin={isAdmin}
              />
              <InstallSettings />
              {/* Follows the account, not the device, as its own words say. */}
              <BlockedMembers />
              {/* How long each request takes, for an administrator; with the
                  other settings of this device, where the owner asked for it
                  (2026-11-18; it was among Club tools for a day). */}
              {isAdmin ? (
                <section aria-labelledby="debug-mode-heading" className="mt-6">
                  <h2
                    id="debug-mode-heading"
                    className="mb-2.5 font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
                  >
                    For administrators
                  </h2>
                  <DebugMode />
                </section>
              ) : null}
            </div>
          </TabPanel>
        ) : null}

        {tab === 'account' ? (
          <TabPanel id="me" value="account">
            <p className="text-[0.875rem] text-ink2 leading-[1.5]">
              Signed in as {member?.displayName ?? displayName ?? '—'}.
            </p>
            {/* Kept mounted on this tab alone, which is why Google's, Apple's
                and the email link's returns open Me here: see `initialTab`. */}
            <SignInSection
              userId={userId}
              state={signIn.state}
              reload={signIn.reload}
              username={changedUsername ?? member?.username ?? null}
              onUsernameChanged={setChangedUsername}
            />
            {/* Side by side on a desktop, under the sign-in cards. */}
            <div className="grid items-start gap-x-6 lg:grid-cols-2">
              <section
                aria-labelledby="me-leaving-heading"
                // DeleteAccount brings its own top margin, sized for following
                // a button; under this heading it only needs a line's gap.
                className="mt-8 [&>:not(h2)]:mt-2.5"
              >
                <h2
                  id="me-leaving-heading"
                  className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
                >
                  Deleting your account
                </h2>
                {userId ? <DeleteAccount userId={userId} isAdmin={isAdmin} /> : null}
              </section>
              {/* Reachable after joining, as Apple 5.1.1(i) and Google Play ask. */}
              <section aria-labelledby="me-legal-heading" className="mt-8">
                <h2
                  id="me-legal-heading"
                  className="font-extrabold font-head text-[0.75rem] text-grey uppercase tracking-[0.13em]"
                >
                  Privacy and terms
                </h2>
                <ul className="mt-1.5">
                  {LEGAL_LINKS.map(([to, label]) => (
                    <li key={to}>
                      <Link
                        to={to}
                        className="inline-flex min-h-[44px] items-center font-semibold text-[0.9375rem] text-emphasis underline"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </TabPanel>
        ) : null}
      </div>
    </div>
  );
}
