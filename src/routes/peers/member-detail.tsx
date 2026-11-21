import { Check, ChevronLeft, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, type Location, useLocation, useNavigate, useParams } from 'react-router-dom';
import { OwnBack } from '@/components/back-line';
import { InjuryStageNote } from '@/components/injury-stage-pill';
import { LinkedText } from '@/components/linked-text';
import { PartnerLabel } from '@/components/partner-label';
import { PhotoViewer } from '@/components/photo-viewer';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { unblockMember, useMyBlocks } from '@/lib/blocks';
import { useChatAuthors } from '@/lib/chat/authors';
import { reportMember, useMyReports } from '@/lib/chat/reports';
import { openDirect } from '@/lib/chat/threads';
import { useICanConnect } from '@/lib/club-partners';
import { describeThrown } from '@/lib/describe-error';
import { mayLinkFamily, removeFamilyLink, useMemberFamily } from '@/lib/family';
import { injuryDateLabel, timeSinceLabel } from '@/lib/injury';
import { useBrowseMember, useOwnMember } from '@/lib/members';
import { useMemberOrganizations } from '@/lib/organization-members';
import { organizationByName, useOrganizations } from '@/lib/organizations';
import { usePhoto } from '@/lib/use-photo';
import { ContinueInRooms } from '@/routes/chat/continue-in-room';
import { ItemActions } from '@/routes/chat/item-actions';
import { ReportSheet } from '@/routes/chat/report-sheet';
import { backToEvents } from '@/routes/events/back';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { backToHome } from '@/routes/home/back';
import { AdminMemberStory } from '@/routes/peers/admin-member-story';
import { BlockMemberSheet } from '@/routes/peers/block-sheet';
import { FamilySection } from '@/routes/peers/family-section';
import { FamilySheet } from '@/routes/peers/family-sheet';
import { IntroduceSheet } from '@/routes/peers/introduce-sheet';
import { gradientFor, initialsOf, SummaryLine } from '@/routes/peers/member-card';
import { MentorSheet, mentorActionLabel, useMentorActions } from '@/routes/peers/mentor-controls';
import { Chips, childrenLabel, DetailRow, Section } from '@/routes/peers/profile-parts';

export { childrenLabel };

import { type Role, RoleOrganizations } from '@/routes/peers/representation-tags';
import { isAdminOfAny, isMentor, RolePill } from '@/routes/peers/role-pill';
import { type BrowseMember, cityAndState, type RepresentedOrganization } from '@/types/domain';

/**
 * One member's full profile — where a tapped card lands.
 *
 * Laid out after the mock's peer page: the photo as a hero with the name over
 * it, then the things members actually search on, then the flatter biographical
 * detail. Sections render only when there is something in them, so a sparse
 * profile reads as short rather than as broken.
 *
 * The one action is Message. The mock also has "Ask <name>", which was never
 * built and which the owner does not want; a control that opens nothing is
 * worse than no control. Report and Block are in the •••.
 */

/**
 * Return to the named screen, even when a tab restored this profile after
 * Chat. Browser history then points at Chat rather than the Peers directory.
 */
export function backToMembers(location: Location): string {
  const state = location.state as { from?: unknown; view?: unknown } | null;
  if (state?.from === 'me') return '/me';
  if (state?.from === 'peers-map') return '/peers?view=map';
  if (state?.view === 'map') return backToEvents(location);
  return backToHome(state) ?? '/peers';
}

export function backFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (from === 'me') return 'Me';
  // A city's members, from the map on Events.
  if ((state as { view?: unknown } | null)?.view === 'map') return 'Events';
  // A photograph's author or a member worth meeting, opened from Home.
  if (from === 'home') return 'Home';
  return 'Peers';
}

/**
 * Message, and where it goes.
 *
 * `chat_open_direct` returns the conversation these two already have or makes
 * it, so this is safe to press twice — `direct_key` is unique and the function
 * re-selects rather than racing. Nothing is created client-side and no id is
 * derived here.
 *
 * Not drawn on your own card, which Me links to. A conversation with yourself
 * is refused by the database in a sentence, and a button whose only outcome is
 * that sentence should not be on the screen.
 *
 * A refusal is printed under the button rather than swallowed. The one that
 * will actually happen is a suspended member, who reads and does not write.
 */
function MessageButton({ memberId, name }: { memberId: string; name: string }) {
  const account = useAccount();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!account.userId || account.userId === memberId) return null;

  return (
    <div>
      <button
        type="button"
        disabled={opening}
        onClick={() => {
          setOpening(true);
          setFailure(null);
          void openDirect(memberId)
            .then((result) => {
              if (!result.ok) {
                setFailure(result.error);
                setOpening(false);
                return;
              }
              void navigate(`/chat/t/${result.value}`);
            })
            .catch((e: unknown) => {
              setFailure(describeThrown(e, 'That did not work.'));
              setOpening(false);
            });
        }}
        // The mock's `btn gold`. Gold is the club's one accent and this is the
        // one action on the page.
        className="flex min-h-[46px] w-full items-center justify-center rounded-[13px] bg-gold px-4 font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-50"
      >
        {opening ? 'Opening…' : `Message ${name}`}
      </button>
      {failure ? (
        <p role="alert" className="mt-2 text-[0.78125rem] text-destructive leading-[1.45]">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/** The @name, which copies itself when pressed (the owner, 2026-10-29: no Copy button). */
function UsernameRow({ username }: { username: string }) {
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  const handle = `@${username}`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <Section title="Username">
      <button
        type="button"
        aria-label={copied ? `Copied ${handle}` : `Copy ${handle}`}
        onClick={() => {
          void navigator.clipboard.writeText(handle).then(
            () => {
              setCopied(true);
              announce(`Copied ${handle}.`);
            },
            () => {
              announce('Could not copy it. Select it and copy instead.');
            },
          );
        }}
        className="-ml-1 inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-[10px] px-1 text-left font-semibold text-[0.9375rem] text-ink"
      >
        <span className="min-w-0 break-all">{handle}</span>
        {copied ? (
          <span className="inline-flex flex-none items-center gap-1 font-bold text-[0.78125rem] text-emphasis">
            <Check className="h-[15px] w-[15px]" aria-hidden="true" />
            Copied
          </span>
        ) : (
          <Copy className="h-[15px] w-[15px] flex-none text-grey" aria-hidden="true" />
        )}
      </button>
    </Section>
  );
}

/** How many a profile shows before the rest go behind "3 more" (the owner, 2026-10-31). */
const MEMBER_OF_SHOWN = 5;

/**
 * What they belong to, for anybody to find one worth joining (the owner,
 * 2026-10-30): the organizations they are in, and what they said on the
 * survey, one list and each once.
 */
function MemberOf({
  memberId,
  affiliations,
}: {
  memberId: string;
  affiliations: readonly string[];
}) {
  const ids = useMemberOrganizations(memberId);
  const { organizations: directory, byId } = useOrganizations();
  const [all, setAll] = useState(false);

  const joined = ids.map((id) => byId.get(id)).filter((organization) => organization !== undefined);
  const said = affiliations.map((name) => ({
    name,
    organization: organizationByName(directory, name),
  }));
  const rows = [
    ...joined.map((organization) => ({ name: organization.name, organization })),
    ...said.filter(
      ({ organization }) => !organization || !joined.some((o) => o.id === organization.id),
    ),
  ]
    .filter(
      (row, index, list) =>
        !row.organization ||
        list.findIndex((other) => other.organization?.id === row.organization?.id) === index,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0) return null;

  const shown = all ? rows : rows.slice(0, MEMBER_OF_SHOWN);
  const chip =
    'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-paper py-1 pr-3.5 pl-1.5 font-bold text-[0.8125rem] text-ink';
  return (
    <Section title="Member of">
      <ul className="flex flex-wrap gap-2">
        {shown.map(({ name, organization }) => (
          <li key={organization?.id ?? name}>
            {organization ? (
              <Link to={`/events/organizations/${organization.id}`} className={chip}>
                <OrganizationBadge organization={organization} size="sm" />
                {organization.name}
              </Link>
            ) : (
              <span className={chip}>
                <OrganizationBadge organization={null} hostName={name} size="sm" />
                {name}
              </span>
            )}
          </li>
        ))}
        {rows.length > shown.length ? (
          <li>
            <button
              type="button"
              onClick={() => {
                setAll(true);
              }}
              className="inline-flex min-h-[44px] items-center px-2 font-bold text-[0.8125rem] text-emphasis underline underline-offset-2"
            >
              {rows.length - shown.length} more
            </button>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

/**
 * How long ago the injury was, at the precision that was given. Says nothing
 * at all when no date was recorded, which is the case for everybody who came
 * from the NorCal SCI directory, or where its member does not show it
 * (20261117030000): the stage pill above it says how long ago instead.
 */
function injuryLine(member: BrowseMember): string | null {
  const since = timeSinceLabel(member);
  const when = injuryDateLabel(member);
  if (since && when) return `${since} · injured ${when}`;
  return since ?? (when ? `Injured ${when}` : null);
}

/**
 * A member the viewer blocked has no profile for them (20261022060000), so
 * this page says so instead, with Unblock.
 */
export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const blocks = useMyBlocks();
  const [justBlocked, setJustBlocked] = useState(false);
  if (blocks.loading) return <Centered role="status">Loading…</Centered>;
  if (id && blocks.ids.has(id)) {
    return <BlockedProfile id={id} focusHeading={justBlocked} onUnblocked={blocks.reload} />;
  }
  return (
    <MemberProfile
      // Read again after Unblock: the profile was hidden until now.
      key={blocks.blocked.length}
      onBlocked={() => {
        setJustBlocked(true);
        blocks.reload();
      }}
    />
  );
}

/** The ••• over a profile's photograph: white on a phone, as the back link is. */
const ACTIONS_BUTTON =
  'text-white drop-shadow-[0_1px_2px_rgba(10,29,54,0.6)] hover:bg-white/15 lg:text-grey lg:drop-shadow-none lg:hover:bg-tint';

function BlockedProfile({
  id,
  focusHeading,
  onUnblocked,
}: {
  id: string;
  focusHeading: boolean;
  onUnblocked: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const announce = useAnnounce();
  const author = useChatAuthors([id]).get(id);
  const name = author?.displayName ?? 'This member';
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  function unblock() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void unblockMember(id).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      announce(`Unblocked ${name}.`);
      onUnblocked();
    });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[560px] px-4 pt-3 pb-8">
        <div className="flex items-center justify-between">
          <OwnBack to={backToMembers(location)} label={backFrom(location.state)} spacer>
            <button
              type="button"
              onClick={() => {
                void navigate(backToMembers(location), { replace: true });
              }}
              className="-ml-1.5 inline-flex min-h-[44px] items-center gap-0.5 py-1.5 font-semibold text-[0.875rem] text-emphasis"
            >
              <ChevronLeft className="h-4 w-4" />
              {backFrom(location.state)}
            </button>
          </OwnBack>
          <ItemActions what={name} title="Member actions">
            <button type="button" onClick={unblock}>
              Unblock {name}
            </button>
          </ItemActions>
        </div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-4 font-extrabold font-display text-[1.875rem] text-ink leading-tight outline-none"
        >
          {name}
        </h1>
        <p className="mt-3 text-[0.9375rem] text-ink2 leading-[1.55]">
          You blocked {name}. You don't see anything they post or send, and neither of you can
          message the other. They have not been told.
        </p>
        <button
          type="button"
          onClick={unblock}
          disabled={busy}
          className="mt-5 min-h-[48px] w-full rounded-[13px] bg-tint px-5 font-bold font-head text-[0.9375rem] text-emphasis transition-colors hover:bg-line disabled:opacity-50"
        >
          {busy ? 'Unblocking…' : `Unblock ${name}`}
        </button>
        {failure ? (
          <p role="alert" className="mt-2 text-[0.875rem] text-destructive leading-[1.45]">
            {failure}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The member as it now stands after an org admin's change here: a peer with a
 * mentor organization is a mentor, and a mentor with none is a peer again,
 * as grant_mentor and revoke_mentor leave the row.
 */
function withMentorOf(member: BrowseMember, mentorOf: RepresentedOrganization[]): BrowseMember {
  const type =
    member.type === 'organization' || member.isAdmin
      ? member.type
      : mentorOf.length > 0
        ? 'mentor'
        : 'peer';
  return { ...member, mentorOrganizations: mentorOf, type };
}

function MemberProfile({ onBlocked }: { onBlocked: () => void }) {
  // Which role pill's organizations are listed, if any.
  const [openRole, setOpenRole] = useState<Role | null>(null);
  const rolesId = useId();
  const toggleRole = (role: Role) => {
    setOpenRole((now) => (now === role ? null : role));
  };
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { member: loaded, loading, error, signedOut, notFound } = useBrowseMember(id);
  // Changed here by an org admin (mentor-controls.tsx), ahead of the next read.
  const [mentorOf, setMentorOf] = useState<{
    memberId: string;
    organizations: RepresentedOrganization[];
  } | null>(null);
  const member =
    loaded && mentorOf?.memberId === loaded.id
      ? withMentorOf(loaded, mentorOf.organizations)
      : loaded;
  // Before the early returns: hooks cannot run conditionally, and every
  // branch below this either renders the profile or does not need the list.
  const account = useAccount();
  const { url: photo, onError: photoFailed } = usePhoto(member?.photoPath);
  // The whole photograph, uncropped, over the page (the owner, 2026-10-15).
  const [photoOpen, setPhotoOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [introducing, setIntroducing] = useState(false);
  const [choosingMentor, setChoosingMentor] = useState(false);
  const [linkingFamily, setLinkingFamily] = useState(false);
  const { family, reload: reloadFamily } = useMemberFamily(member?.id);
  const me = useOwnMember(account.userId).member;
  const canConnect = useICanConnect(account.userId);
  const reports = useMyReports();
  const announce = useAnnounce();
  const mentoring = useMentorActions({
    memberId: member?.id ?? null,
    displayName: member?.displayName ?? '',
    mentorOf: member?.mentorOrganizations ?? [],
    onChange: (organizations) => {
      if (member) setMentorOf({ memberId: member.id, organizations });
    },
  });
  // Focus goes back here on close: Safari does not focus a button it clicks.
  const photoButton = useRef<HTMLButtonElement | null>(null);
  // The ••• that opened the report sheet. The menu closes under it, so the
  // sheet has no opener to give focus back to.
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const wasReporting = useRef(false);
  useEffect(() => {
    if (wasReporting.current && !reporting) menuButton.current?.focus();
    wasReporting.current = reporting;
  }, [reporting]);
  const wasChoosingMentor = useRef(false);
  useEffect(() => {
    if (wasChoosingMentor.current && !choosingMentor) menuButton.current?.focus();
    wasChoosingMentor.current = choosingMentor;
  }, [choosingMentor]);
  const wasLinkingFamily = useRef(false);
  useEffect(() => {
    if (wasLinkingFamily.current && !linkingFamily) menuButton.current?.focus();
    wasLinkingFamily.current = linkingFamily;
  }, [linkingFamily]);
  const wasIntroducing = useRef(false);
  useEffect(() => {
    if (wasIntroducing.current && !introducing) menuButton.current?.focus();
    wasIntroducing.current = introducing;
  }, [introducing]);

  if (loading) {
    return <Centered role="status">Loading…</Centered>;
  }
  if (signedOut) {
    return <Centered>The club is members only. Sign in to see who is here.</Centered>;
  }
  if (notFound) {
    return <Centered>That member is not in the club.</Centered>;
  }
  if (error || !member) {
    return <Centered>{error ?? 'Could not load this member.'}</Centered>;
  }

  const [from, to] = gradientFor(member.id);
  const injury = injuryLine(member);
  const canMessage = account.userId !== null && account.userId !== member.id;
  // The reader's own link with this member, if any (src/lib/family.ts).
  const ours = family.find((link) => link.memberId === account.userId);
  const mayLink = me !== null && mayLinkFamily(me, member);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative mx-auto w-full max-w-[62rem] lg:px-4 lg:pt-3">
        {/* The way back on the left and, for a mentor, a gold chip on the
            right — the deck's own colour for the word.

            On a phone the row lies over the top of the photograph (owner,
            2026-09-21, reversing the morning's "above it, not on it"): the
            strip it took above the picture was 58px of nothing, and the
            picture is the point of this screen. White, over a scrim, so it
            reads on a bright sky. From `lg` the picture is a floated card and
            the row goes back above everything, in navy on the canvas. */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-3 lg:static lg:px-0 lg:pt-0 lg:pb-2.5">
          <OwnBack to={backToMembers(location)} label={backFrom(location.state)} spacer>
            <button
              type="button"
              onClick={() => {
                void navigate(backToMembers(location), { replace: true });
              }}
              className="-ml-1.5 inline-flex min-h-[36px] items-center gap-0.5 py-1.5 font-semibold text-[0.875rem] text-white drop-shadow-[0_1px_2px_rgba(10,29,54,0.6)] lg:text-emphasis lg:drop-shadow-none"
              data-target="small"
            >
              <ChevronLeft className="h-4 w-4" />
              {backFrom(location.state)}
            </button>
          </OwnBack>
          {/* An administrator's profile is their own, with an Admin chip
              beside Peer mentor (the owner, 2026-10-01); it was the club's
              "official account" page until administrators were people. */}
          <span className="flex items-center gap-1.5">
            {isMentor(member) || isAdminOfAny(member) || member.type === 'organization' ? (
              <span className="flex flex-wrap justify-end gap-1.5">
                {isMentor(member) ? (
                  <RolePill
                    kind="mentor"
                    organizations={member.mentorOrganizations}
                    expanded={openRole === 'mentor'}
                    controls={rolesId}
                    onToggle={() => {
                      toggleRole('mentor');
                    }}
                  />
                ) : null}
                {member.type === 'organization' ? (
                  <span className="inline-flex items-center rounded-full bg-white px-2.5 py-[5px] font-bold text-[0.6875rem] text-navy uppercase">
                    Organization account
                  </span>
                ) : null}
                {isAdminOfAny(member) ? (
                  <RolePill
                    kind="admin"
                    organizations={member.representedOrganizations}
                    className="lg:bg-action lg:text-white"
                    expanded={openRole === 'admin'}
                    controls={rolesId}
                    onToggle={() => {
                      toggleRole('admin');
                    }}
                  />
                ) : null}
              </span>
            ) : null}
            {canMessage ? (
              <ItemActions
                what={member.displayName}
                title="Member actions"
                buttonClassName={ACTIONS_BUTTON}
                buttonRef={menuButton}
              >
                {mentoring.actions.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setChoosingMentor(true);
                    }}
                  >
                    Mentor for which organization…
                  </button>
                ) : (
                  mentoring.actions.map((action) => (
                    <button
                      key={action.organization.id}
                      type="button"
                      onClick={() => {
                        mentoring.run(action);
                      }}
                    >
                      {mentorActionLabel(action)}
                    </button>
                  ))
                )}
                {/* An org admin's or a professional's (20261031110000). */}
                {canConnect ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIntroducing(true);
                    }}
                  >
                    Introduce {member.displayName}…
                  </button>
                ) : null}
                {/* Asked of the reader: answered on the page, not here. */}
                {!ours && mayLink ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLinkingFamily(true);
                    }}
                  >
                    Link {member.displayName} as family…
                  </button>
                ) : ours && ours.state !== 'asked_of_me' ? (
                  <button
                    type="button"
                    onClick={() => {
                      void removeFamilyLink(ours.linkId).then((result) => {
                        announce(
                          result.ok
                            ? ours.state === 'linked'
                              ? `${member.displayName} is no longer linked as family.`
                              : 'Request cancelled.'
                            : result.error,
                        );
                        reloadFamily();
                      });
                    }}
                  >
                    {ours.state === 'linked' ? 'Remove family link' : 'Cancel family request'}
                  </button>
                ) : null}
                {reports.memberIds.has(member.id) ? (
                  <p className="flex min-h-11 items-center px-3 text-grey text-sm">
                    You reported {member.displayName}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReporting(true);
                    }}
                  >
                    Report {member.displayName}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBlocking(true);
                  }}
                >
                  Block {member.displayName}
                </button>
              </ItemActions>
            ) : null}
          </span>
        </div>
        {reporting ? (
          <ReportSheet
            kind="profile"
            overPage
            onCancel={() => {
              setReporting(false);
            }}
            onSend={async (note) => {
              const result = await reportMember(member.id, note);
              if (!result.ok) return result.error;
              // Read back what the database holds rather than assuming it took.
              reports.reload();
              announce(`You reported ${member.displayName}. They have not been told.`);
              setReporting(false);
              return null;
            }}
          />
        ) : null}
        {linkingFamily ? (
          <FamilySheet
            memberId={member.id}
            name={member.displayName}
            onCancel={() => {
              setLinkingFamily(false);
            }}
            onSent={() => {
              setLinkingFamily(false);
              announce(`Asked ${member.displayName}. You are linked once they say yes.`);
              reloadFamily();
            }}
          />
        ) : null}
        {introducing ? (
          <IntroduceSheet
            member={member}
            onCancel={() => {
              setIntroducing(false);
            }}
            onSent={() => {
              setIntroducing(false);
            }}
          />
        ) : null}
        {choosingMentor ? (
          <MentorSheet
            displayName={member.displayName}
            actions={mentoring.actions}
            run={mentoring.run}
            error={mentoring.error}
            onClose={() => {
              setChoosingMentor(false);
            }}
          />
        ) : null}
        {blocking ? (
          <BlockMemberSheet
            memberId={member.id}
            name={member.displayName}
            onCancel={() => {
              setBlocking(false);
            }}
            onBlocked={onBlocked}
          />
        ) : null}
        {/*
         * From `lg` the picture is floated, not a column: the profile runs
         * beside it and then takes the whole width once it is past the bottom
         * of the photograph.
         *
         * It was a two-column grid, which fixed the picture's column at 20rem
         * and gave the rest of the page the other one. That kept every profile
         * the same shape — the reason it was built that way, and still worth
         * having — but the left column ended with the photograph and the page
         * carried on for another 776 measured pixels beside an empty strip.
         *
         * The float keeps the fixed 20rem so the shape is still constant, and
         * spends the space underneath on the profile instead of on nothing.
         */}
        <div className="lg:block">
          <div className="lg:float-left lg:mr-8 lg:mb-3 lg:w-[20rem] lg:overflow-hidden lg:rounded-[26px] lg:shadow-[0_10px_26px_rgba(10,20,35,.18)]">
            {/* The mock's `phero`: the photograph as a 300px hero with the
             * name over its foot, edge to edge on a phone. The mock also puts
             * the back button and a badge with an organization mark on the
             * picture; the owner moved both above it and dropped the mark. */}
            {/*
             *
             * It used to be the whole photograph, uncropped, with the name
             * underneath, on the argument that a profile is where somebody
             * actually looks at the person. The owner asked for the mock's
             * shape instead (2026-09-21), and the deck already crops these to a
             * tall card, so a crop is nothing a member has not already seen.
             * The face is kept by `object-position` at 26% from the top — the
             * deck uses 28% — which is where a portrait's face sits.
             *
             * 350px and not a share of the viewport. Most members open this in
             * a browser, where the URL bar takes its cut of the height before
             * the page gets any; a `vh` hero is either too tall there or too
             * short in the installed app. A fixed height leaves the name and
             * the button on the first screen in both. It was 300 with a 58px
             * row above it; the row now lies on the picture, and the picture
             * has the room it took.
             *
             * From `lg` it is the 20rem picture the float always had, 4:5
             * rather than 300px, with the same overlay — one DOM for every
             * width rather than a hidden twin of the name. */}
            <div
              className="relative h-[350px] overflow-hidden lg:aspect-[4/5] lg:h-auto"
              style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center font-extrabold font-display text-[6.5rem] text-white opacity-[0.13]"
              >
                {initialsOf(member.displayName)}
              </span>
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-[50%_26%]"
                  onError={photoFailed}
                />
              ) : null}
              {/* A short scrim at the top for the back button and the chip
                  that lie on the picture on a phone; gone from `lg`, where
                  they are above it. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[90px] bg-gradient-to-b from-black/50 to-transparent lg:hidden"
              />
              {/* Clear at the top, a neutral shade at the foot (the owner,
                  2026-10-13: not navy, so the photo keeps its colours), so the
                  name reads on a light photograph and on the gradient alike. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[190px] bg-gradient-to-b from-transparent via-black/55 via-60% to-black/75"
              />
              {/* The hero crops the photograph to a banner. Pressing it shows
                  the whole of it, and zooms (src/components/photo-viewer.tsx).
                  A layer over the picture rather than round it, so the name
                  over its foot is pressed through, not in the way. */}
              {photo ? (
                <button
                  ref={photoButton}
                  type="button"
                  aria-label={`Open ${member.displayName}’s photograph`}
                  onClick={(event) => {
                    photoButton.current = event.currentTarget;
                    setPhotoOpen(true);
                  }}
                  className="absolute inset-0 cursor-zoom-in"
                />
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 px-[18px] pb-3.5">
                <h1 className="font-extrabold font-display text-[1.875rem] text-white leading-tight tracking-[-0.01em]">
                  {member.displayName}
                </h1>
                {member.username ? (
                  <p className="mt-0.5 font-semibold text-[0.9375rem] text-white">
                    @{member.username}
                  </p>
                ) : null}
                <PartnerLabel memberId={member.id} variant="pill" className="mt-1.5" />
                <p className="mt-1 text-[0.875rem] text-white">
                  <SummaryLine member={member} />
                </p>
                <InjuryStageNote member={member} className="mt-1.5" />
                {injury ? <p className="mt-1 text-[0.78125rem] text-white/90">{injury}</p> : null}
              </div>
            </div>

            {photoOpen && photo ? (
              <PhotoViewer
                url={photo}
                // Their own description, when they wrote one.
                label={
                  member.photoAlt?.trim()
                    ? member.photoAlt.trim()
                    : `Photograph of ${member.displayName}`
                }
                title={`${member.displayName}’s photograph`}
                index={0}
                count={1}
                onStep={() => undefined}
                onClose={() => {
                  setPhotoOpen(false);
                  photoButton.current?.focus();
                }}
              />
            ) : null}

            {/* One gold button straight under the photograph, on the page
                (the owner, 2026-10-13: no band behind it). Full width; from
                `lg` it closes the floated card on paper. Not drawn on your
                own profile, where there is nothing to press. */}
            {canMessage ? (
              <div className="px-[18px] pt-4 lg:bg-paper lg:pb-4">
                <MessageButton memberId={member.id} name={member.displayName} />
              </div>
            ) : null}
          </div>

          {/* `contents` at lg so the sections below become siblings of the
              floated picture and flow past it one at a time. Wrapped in a box
              of their own they would all sit beside it or all below it, which
              is the grid this replaced. */}
          <div className="min-w-0 px-4 lg:contents">
            {openRole ? (
              <RoleOrganizations
                id={rolesId}
                role={openRole}
                organizations={
                  openRole === 'mentor'
                    ? member.mentorOrganizations
                    : member.representedOrganizations
                }
              />
            ) : null}
            {mentoring.error ? (
              <p role="alert" className="mt-3 text-[0.8125rem] text-destructive leading-[1.45]">
                {mentoring.error}
              </p>
            ) : null}
            {/* The owner's order, 2026-10-10: who they are in their own words,
                then how it happened, then what they will talk about and do,
                then the flatter details card. "Bio" because that is what the
                survey now asks for ("Brief bio"). */}
            {/* Above Bio, to copy for an @mention (the owner, 2026-10-29): the
                one over the photograph cannot be selected. */}
            {member.username ? <UsernameRow username={member.username} /> : null}
            {member.bio ? (
              <Section title="Bio">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.bio} />
                </p>
              </Section>
            ) : null}

            <FamilySection
              member={member}
              readerId={account.userId}
              family={family}
              onChanged={reloadFamily}
            />

            {member.howInjured ? (
              <Section title="How it happened">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">{member.howInjured}</p>
              </Section>
            ) : null}

            {member.topics.length ? (
              <Section title="Happy to talk about">
                <p className="-mt-1 mb-2.5 text-[0.78125rem] text-grey leading-[1.45]">
                  What {member.displayName} offered to be asked about.
                </p>
                <Chips items={member.topics} tone="solid" />
              </Section>
            ) : null}

            {member.interests.length ? (
              <Section title="Interests">
                <Chips items={member.interests} tone="outline" />
              </Section>
            ) : null}

            {/* "The specifics" from the survey, under the self-care answers it
                spells out — which program, which modifications, which device.
                It was collected and never shown, though the survey tells the
                member it is what people message them about. */}
            {member.selfCare.length || member.detail ? (
              <Section title="Uses day to day">
                {member.selfCare.length ? <Chips items={member.selfCare} tone="gold" /> : null}
                {member.detail ? (
                  <p
                    className={`${member.selfCare.length ? 'mt-2.5 ' : ''}text-[0.8875rem] text-ink2 leading-[1.52]`}
                  >
                    <LinkedText text={member.detail} />
                  </p>
                ) : null}
              </Section>
            ) : null}

            {/* Above the equipment (the owner, 2026-10-31). */}
            <MemberOf memberId={member.id} affiliations={member.affiliations} />

            {member.sportsEquipment ? (
              <Section title="Adaptive sports equipment">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.sportsEquipment} />
                </p>
              </Section>
            ) : null}

            {member.grants ? (
              <Section title="Grants">
                <p className="text-[0.8875rem] text-ink2 leading-[1.52]">
                  <LinkedText text={member.grants} />
                </p>
              </Section>
            ) : null}

            <Section title="Details">
              {/* `flow-root` so the card sits beside the floated picture and
                  narrows, instead of sliding its border underneath it. A plain
                  block only wraps its text around a float; a bordered box has
                  to be told to keep out of the way. */}
              <div className="flow-root rounded-[17px] border border-line bg-paper px-3.5 py-1">
                <DetailRow label="Independence" value={member.independence} />
                <DetailRow label="Work" value={member.employment} />
                <DetailRow label="Field" value={member.fieldOfWork} />
                <DetailRow label="Education" value={member.education} />
                <DetailRow
                  label="Children"
                  value={childrenLabel(member.hasChildren, member.childrenWhen)}
                />
                <DetailRow
                  label="Languages"
                  value={member.languages.length ? member.languages.join(', ') : null}
                />
                <DetailRow label="Where" value={cityAndState(member)} />
              </div>
            </Section>

            {/* The rooms this member's topics reach, after everything about
                the member: the page is for reading the person, and these were
                taking the first screen of it on a phone (owner, 2026-10-07).
                Draws nothing — heading included — unless a topic reaches a
                room that is open, which for most of this club's life is
                nothing. */}
            <ContinueInRooms
              topics={member.topics}
              wrap={(links) => <Section title="Talk about it in the club">{links}</Section>}
            />

            {/* The provenance sentence is only true of the seeded directory rows.
            Somebody who signed up never published anything in a directory, and
            telling them they did is a small lie that undermines every other
            claim on the page, so for them there is no box at all. (It used to
            carry a second sentence about contact details, removed 2026-10-10.) */}
            {member.isSeed ? (
              <div className="mt-5 rounded-r-[11px] border-gold border-l-[3px] bg-gold-lt px-3.5 py-3 text-[0.7875rem] text-gold-ink leading-[1.5]">
                Everything here is what {member.displayName} chose to publish in the NorCal SCI
                mentor directory.
              </div>
            ) : null}

            {/* Last of all, for the club's administrators only (the owner,
                2026-11-18); the database refuses anybody else. */}
            {account.isAdmin && member.type !== 'organization' && !member.isSeed ? (
              <AdminMemberStory memberId={member.id} name={member.displayName} />
            ) : null}
          </div>
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}

function Centered({ children, role }: { children: React.ReactNode; role?: 'status' }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <p role={role} className="text-center text-[0.875rem] text-ink2 leading-relaxed">
        {children}
      </p>
    </div>
  );
}
