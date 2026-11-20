import { useState } from 'react';
import { InjuryStageNote } from '@/components/injury-stage-pill';
import { PartnerLabel } from '@/components/partner-label';
import { organizationByName, useOrganizations } from '@/lib/organizations';
import { usePhotoUrl } from '@/lib/photos';
import { usePhoto } from '@/lib/use-photo';
import { cn } from '@/lib/utils';
import { Blurred, STAND_IN_AGE, STAND_IN_PLACE, TeamName } from '@/routes/about/blurred';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { isAdminOfAny, isMentor, RolePill } from '@/routes/peers/role-pill';
import { asksCompleteness, type BrowseMember, cityAndState, injuryLabel } from '@/types/domain';

/**
 * The full-bleed browse card, matching `.pcard` in docs/index.html. The photo
 * *is* the card: it fills the frame and everything else sits on top of it.
 *
 * Purely presentational. It takes a member and a tap handler; it never fetches
 * and holds no state.
 */

/** Deterministic gradient pairs for members with no photo, from the mock's palette. */
const DEFAULT_GRADIENT: [string, string] = ['#102A4C', '#1A3E70'];

const PALETTE: [string, string][] = [
  DEFAULT_GRADIENT,
  ['#1A3E70', '#2C5590'],
  ['#8A6512', '#D4A83A'],
  ['#2F6B57', '#3E8F74'],
  ['#4A2E6B', '#6B4494'],
];

/** Stable per-member, so somebody's tile colour does not change between renders. */
export function gradientFor(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? DEFAULT_GRADIENT;
}

export function initialsOf(displayName: string): string {
  const letters = displayName
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, '').charAt(0))
    .filter(Boolean);
  return (letters.slice(0, 2).join('') || '?').toUpperCase();
}

/**
 * The line under the name: level, completeness, age, city.
 *
 * Every part is optional and the separators come from joining what survives, so
 * a member with no city or no age gets a shorter line rather than a line with a
 * gap in it. Completeness is lowercased to read as prose — "C6 incomplete"
 * rather than "C6 Incomplete" — and omitted entirely when unknown, because
 * "C6 do not know" says nothing.
 */
export function summaryLine(member: BrowseMember): string {
  return [levelPart(member), member.age, cityAndState(member)].filter(Boolean).join(' · ');
}

/** The summary line on a photograph. */
export function SummaryLine({ member }: { member: BrowseMember }) {
  // Each part kept whole with the dot after it, so a line breaks between
  // parts, never inside a city ("San / Francisco"), and never starts on a dot.
  const rest = [member.age, cityAndState(member)].filter(Boolean);
  return (
    <>
      <span className="whitespace-nowrap">
        {levelPart(member)}
        {rest.length > 0 ? ' ·' : null}
      </span>
      {rest.map((part, index) => (
        <span key={String(part)}>
          {' '}
          <span className="whitespace-nowrap">
            {part}
            {index < rest.length - 1 ? ' ·' : null}
          </span>
        </span>
      ))}
    </>
  );
}

/** The level and completeness, the first part of the summary line. */
export function levelPart(member: BrowseMember): string {
  const level = injuryLabel(member);
  // A condition or central cord syndrome says what it is; complete or
  // incomplete belongs to an injury with a level.
  return member.completeness === 'Do not know' || !asksCompleteness(member.injuryType)
    ? level
    : `${level} ${member.completeness.toLowerCase()}`;
}

/**
 * How many organization marks fit on a card before the row starts competing
 * with the topic chips under it. Three covers the directory as it stands — the
 * busiest member has three — and anything past that is counted rather than
 * drawn, so a member who joins six does not push the chips off the card.
 */
const MAX_CARD_AFFILIATIONS = 3;

/** An organization's badge letters, from its name, when we only have the name. */
export function shortCodeFor(organizationName: string): string {
  const words = organizationName.split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).toUpperCase();
  return words
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 4)
    .toUpperCase();
}

export interface MemberCardProps {
  member: BrowseMember;
  onOpen: () => void;
  /** The first cards on screen: the photo is fetched first, not lazily. */
  priority?: boolean;
  /** About us, for anybody: the age and city blurred (routes/about/blurred.tsx). */
  publicView?: boolean;
  /** About us: a last name was left off, and is drawn blurred after the first. */
  lastNameHidden?: boolean;
  /** What the deck is sorted by, for this member ("12 mi away"). */
  sortNote?: string | null;
}

/**
 * An administrator's card is their own, photograph, name and all, with an
 * Admin flag under the Mentor one (the owner, 2026-10-01). Until then an
 * administrator was drawn as "the club's own account", a navy card with the
 * club's mark: right while the only one was the club's account, wrong once
 * administrators were members running the club as themselves.
 */
export function MemberCard({
  member,
  onOpen,
  priority = false,
  publicView = false,
  lastNameHidden = false,
  sortNote = null,
}: MemberCardProps) {
  return (
    <PersonCard
      member={member}
      onOpen={onOpen}
      priority={priority}
      publicView={publicView}
      lastNameHidden={lastNameHidden}
      sortNote={sortNote}
    />
  );
}

function PersonCard({
  member,
  onOpen,
  priority = false,
  publicView = false,
  lastNameHidden = false,
  sortNote = null,
}: MemberCardProps) {
  const { organizations } = useOrganizations();
  // The small copy draws at once; the photograph covers it once it is in.
  const { url: small, onError: smallFailed } = usePhoto(member.photoPath, 'thumb');
  const photo = usePhotoUrl(member.photoPath);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [from, to] = gradientFor(member.id);
  const chips = member.topics.slice(0, 3);
  const mentor = isMentor(member);
  const admin = isAdminOfAny(member);
  // Every affiliation, as a mark. It was `affiliations[0]` with its name
  // spelled out beside it, which read as one organization per member and, in
  // the live directory, as *the same* organization on every card: NorCal SCI is
  // first for all 23 members who have one, so six other bodies never appeared
  // in the deck at all. Marks are narrow enough to show all of them; the names
  // are on the profile, which is where there is room to read them.
  const affiliations = member.affiliations.slice(0, MAX_CARD_AFFILIATIONS);
  const overflow = member.affiliations.length - affiliations.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block h-[400px] w-full overflow-hidden rounded-[26px] text-left shadow-[0_10px_26px_rgba(10,20,35,.18)]"
      style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}
    >
      {/* The initials sit behind the photo, so a photo that fails to load
          reveals a designed tile rather than a broken-image icon. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center font-extrabold font-display text-[118px] text-white opacity-[0.13] tracking-[-0.01em]"
      >
        {initialsOf(member.displayName)}
      </span>

      {small ? (
        <img
          src={small}
          alt=""
          // The first cards are the screen's largest picture; the rest wait
          // until they are scrolled near.
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[50%_28%]"
          onError={smallFailed}
        />
      ) : null}
      {photo && photo !== small ? (
        <img
          src={photo}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          // Shown whole once it has loaded, never drawn in over the copy.
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-[50%_28%]',
            loaded === photo ? '' : 'opacity-0',
          )}
          onLoad={() => {
            setLoaded(photo);
          }}
        />
      ) : null}

      {/* Neutral shade, not navy (the owner, 2026-10-13): the photo keeps its
          colours. The top one carries the white name on a light photo; the
          bottom one is lighter, as the chips and marks there are on their
          own white pills. */}
      <span className="absolute inset-x-0 top-0 h-[210px] bg-gradient-to-b from-black/65 via-black/45 via-55% to-transparent" />
      <span className="absolute inset-x-0 bottom-0 h-[160px] bg-gradient-to-b from-transparent to-black/45" />

      {/* Stacked, not side by side: the name keeps the same room beside one
          flag or two. Admin is white on the photograph so it is not read as a
          second Mentor. */}
      {/* Mentor and Admin carry the logos of the organizations they are for
          (the owner, 2026-10-28). Admin is white so it is not read as a
          second Mentor. */}
      {mentor || admin || member.type === 'organization' ? (
        <span className="absolute top-[18px] right-[18px] z-10 flex flex-col items-end gap-1.5">
          {mentor ? (
            <RolePill
              kind="mentor"
              organizations={member.mentorOrganizations}
              className="shadow-[0_2px_8px_rgba(10,20,35,.35)]"
            />
          ) : null}
          {member.type === 'organization' ? (
            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-[5px] font-bold text-[0.6875rem] text-navy uppercase">
              Organization account
            </span>
          ) : null}
          {admin ? (
            <RolePill
              kind="admin"
              organizations={member.representedOrganizations}
              className="shadow-[0_2px_8px_rgba(10,20,35,.35)]"
            />
          ) : null}
        </span>
      ) : null}

      {/* Room on the right only for the flags drawn there. */}
      <span
        className={cn(
          'absolute inset-x-0 top-0 block px-[18px] pt-[18px]',
          mentor || admin || member.type === 'organization' ? 'pr-[104px]' : '',
        )}
      >
        <span className="block font-extrabold font-display text-[1.75rem] text-white leading-tight tracking-[-0.01em] [text-shadow:0_1px_12px_rgba(0,0,0,.75)]">
          <TeamName first={member.displayName} lastNameHidden={lastNameHidden} />
        </span>
        {member.username ? (
          <span className="mt-0.5 block font-semibold text-[0.84375rem] text-white leading-[1.35] [text-shadow:0_1px_10px_rgba(0,0,0,.8)]">
            @{member.username}
          </span>
        ) : null}
        {publicView ? null : (
          <PartnerLabel memberId={member.id} variant="pill" className="mt-1.5" />
        )}
        <span className="mt-[7px] block text-[0.84375rem] text-white leading-[1.45] [text-shadow:0_1px_10px_rgba(0,0,0,.8)]">
          {publicView ? (
            <>
              {/* The dot stays with what is before it, so a wrapped line never starts on
                  one, as in SummaryLine (the owner, 2026-11-20). */}
              <span className="whitespace-nowrap">{levelPart(member)} ·</span>{' '}
              <span className="whitespace-nowrap">
                <Blurred>{STAND_IN_AGE}</Blurred> · <Blurred>{STAND_IN_PLACE}</Blurred>
              </span>
            </>
          ) : (
            <SummaryLine member={member} />
          )}
        </span>
        <InjuryStageNote member={member} className="mt-1.5" />
        {sortNote ? (
          <span className="mt-0.5 block font-semibold text-[0.84375rem] text-white leading-[1.45] [text-shadow:0_1px_10px_rgba(0,0,0,.8)]">
            {sortNote}
          </span>
        ) : null}
      </span>

      <span className="absolute inset-x-0 bottom-0 block px-[18px] pb-5">
        {affiliations.length > 0 ? (
          <span className="inline-flex items-center gap-[5px] rounded-full bg-white/95 px-[5px] py-[5px] font-extrabold text-[0.75rem] text-navy leading-none">
            {/* The organization's own logo where the club has a row for it,
                the short-code tile where it does not — several affiliations
                on these rows are bodies the club has no organization for. */}
            {affiliations.map((name) => (
              <OrganizationBadge
                key={name}
                organization={organizationByName(organizations, name)}
                hostName={name}
                className="h-[2.59em] w-[2.59em] rounded-[0.82em] text-[0.53125rem]"
              />
            ))}
            {overflow > 0 ? <span className="pr-1.5 pl-0.5">+{overflow}</span> : null}
            {/* The badges are aria-hidden by contract — they are drawn beside
                their own name everywhere else. Here there is no name to read,
                so the row carries one. */}
            <span className="sr-only">{member.affiliations.join(', ')}</span>
          </span>
        ) : null}
        {chips.length ? (
          <span className={cn('flex flex-wrap gap-2', affiliations.length > 0 ? 'mt-3' : 'mt-0')}>
            {chips.map((topic) => (
              <span
                key={topic}
                className="inline-block rounded-full bg-white/92 px-3 py-[7px] font-bold text-[0.75rem] text-navy leading-[1.2]"
              >
                {topic}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}
