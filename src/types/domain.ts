import type { OrganizationCategory } from '@/lib/organization-categories';

/**
 * Domain types for The SCI Club.
 *
 * Single source of truth for every shape in the app. Additive changes are fine; renaming a field
 * is a conversation first. Where this disagrees with CONTEXT.md, CONTEXT.md wins and this
 * file is what should change.
 *
 * Vocabulary, per CONTEXT.md: everyone is a **Member**. **Mentor** is an attribute of a
 * member, not a separate kind of person. There is no "user" and no "peer" as an identity.
 */

/* ------------------------------------------------------------------ injury */

/**
 * The coarse level range asked during onboarding. Six options, answerable in one tap by somebody
 * who may be filling this in from a hospital bed — the exact level is asked later, in the profile
 * survey, by anyone who wants to give it.
 */
export const LEVEL_RANGES = ['C1–C4', 'C5–C8', 'T1–T6', 'T7–T12', 'L1–S5', 'Not sure yet'] as const;
export type LevelRange = (typeof LEVEL_RANGES)[number];

/** The exact level, refined in the profile survey. Optional — the range is what onboarding sets. */
export const EXACT_LEVELS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  // Injuries between two segments. People describe themselves this way, and the
  // NorCal SCI directory records four of them.
  'C4/5',
  'C5/6',
  'C6/7',
  'T11/12',
  'Do not know',
] as const;
export type ExactLevel = (typeof EXACT_LEVELS)[number];

/**
 * Region, derived from the range rather than stored by hand. This is what the Peers filter groups
 * on, and it is a generated column in the database for the same reason it is a function here:
 * a filter and a profile must never disagree about which region someone is in.
 */
export const INJURY_REGIONS = ['Cervical', 'Thoracic', 'Lumbar & sacral', 'Unknown'] as const;
export type InjuryRegion = (typeof INJURY_REGIONS)[number];

/**
 * How long ago somebody was injured, shown in place of the date, which is
 * hidden unless its member shows it (20261117030000, the owner, 2026-11-17).
 * Under six months, under two years, under ten, under forty, forty and more.
 */
export const INJURY_STAGES = ['new', 'recent', 'years', 'og', 'oog'] as const;
export type InjuryStage = (typeof INJURY_STAGES)[number];

/**
 * How long ago, finer, for the pill's colour (20261118226000, the owner,
 * 2026-11-18): under 6 months, 6-12 months, 1-2 years, 2-5, 5-10, 10-20,
 * 20-30, 30-40, 40-50, 50 and more. Green to red at ten years, then to dark
 * purple. The words stay the stage.
 */
export const INJURY_BANDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type InjuryBand = (typeof INJURY_BANDS)[number];

export function regionForRange(range: LevelRange): InjuryRegion {
  switch (range) {
    case 'C1–C4':
    case 'C5–C8':
      return 'Cervical';
    case 'T1–T6':
    case 'T7–T12':
      return 'Thoracic';
    case 'L1–S5':
      return 'Lumbar & sacral';
    case 'Not sure yet':
      return 'Unknown';
  }
}

/**
 * The coarse range an exact level falls into, by its first segment.
 *
 * Derived rather than asked twice: onboarding collects the exact level, and the
 * range exists so a filter has something broad to group on. Taking the first
 * segment of a between-segments level ("C4/5" -> C4) is the conservative read —
 * it does not overstate function.
 */
export function rangeForExact(level: ExactLevel): LevelRange {
  if (level === 'Do not know') return 'Not sure yet';
  const match = /^([CTLS])(\d+)/.exec(level);
  if (!match) return 'Not sure yet';
  const segment = match[1];
  const n = Number(match[2]);
  if (segment === 'C') return n <= 4 ? 'C1–C4' : 'C5–C8';
  if (segment === 'T') return n <= 6 ? 'T1–T6' : 'T7–T12';
  return 'L1–S5';
}

/**
 * What kind of injury or condition, asked with the level (the owner,
 * 2026-10-15; first asked 2026-10-14):
 *
 *   quad, high_para, low_para   an injury with a level, cut to fit
 *   condition                   "Other spinal cord condition": typed, with
 *                               suggestions, and a level if it has one
 *   family                      family or a friend of someone with SCI: a
 *                               member with no level
 *   professional                staff, working with people with SCI/D (20261029100000):
 *                               no level either; it grants nothing
 *
 * 'para' and 'central_cord' are what the question offered before. Members who
 * gave them keep them, and they read and filter as they did, but they are no
 * longer offered. Null for a member who joined before the kind was asked, or
 * who would rather not say.
 */
export const INJURY_TYPES = [
  'quad',
  'high_para',
  'low_para',
  'condition',
  'family',
  'professional',
  'para',
  'central_cord',
] as const;
export type InjuryType = (typeof INJURY_TYPES)[number];

/** The answers "Which describes you best?" offers, in order. */
export const OFFERED_INJURY_TYPES = [
  'quad',
  'high_para',
  'low_para',
  'condition',
  'family',
  'professional',
] as const satisfies readonly InjuryType[];

export const INJURY_TYPE_TEXT: Record<InjuryType, { title: string }> = {
  quad: { title: 'Quadriplegic (tetraplegic)' },
  high_para: { title: 'High para (T1–T8)' },
  low_para: { title: 'Low para (T9+)' },
  condition: { title: 'Spinal cord or nerve disorder' },
  // Wording the owner chose, 2026-11-15; the stored values stay 'family' and
  // 'professional', which the iPhone app already on phones also sends.
  family: { title: 'Family / friend of someone with SCI' },
  professional: { title: 'Staff / I work with people with SCI/D' },
  para: { title: 'Paraplegia' },
  central_cord: { title: 'Central cord syndrome' },
};

/**
 * Suggested under "Which condition?" while typing (the owner's list,
 * 2026-10-14, then central cord syndrome, then nerve disorders, 2026-10-29).
 * Anything typed is kept as written.
 */
export const SPINAL_CORD_CONDITIONS = [
  'Transverse myelitis',
  'Spina bifida',
  'Multiple sclerosis',
  'Neuromyelitis optica (NMOSD)',
  'Spinal cord tumor',
  'Spinal cord stroke',
  'Spinal arteriovenous malformation (AVM)',
  'Syringomyelia',
  'Tethered cord syndrome',
  'Cervical myelopathy (spinal stenosis)',
  'Cauda equina syndrome',
  'Conus medullaris syndrome',
  'Brown-Séquard syndrome',
  'Anterior cord syndrome',
  'Hereditary spastic paraplegia',
  'Acute flaccid myelitis',
  'Spinal cord infection or abscess',
  'Spinal muscular atrophy (SMA)',
  'ALS (motor neuron disease)',
  'Post-polio syndrome',
  'Guillain-Barré syndrome',
  'CIDP (chronic inflammatory demyelinating polyneuropathy)',
  "Friedreich's ataxia",
  'Charcot-Marie-Tooth disease',
  'Peripheral neuropathy',
  'Central cord syndrome',
] as const;

/** Longest a typed condition may be; the database holds it to the same. */
export const CONDITION_NAME_MAX = 100;

/** T1 is 1, T12 is 12, T11/12 is 11; null for a level that is not thoracic. */
function thoracic(level: ExactLevel): number | null {
  const match = /^T(\d+)/.exec(level);
  return match ? Number(match[1]) : null;
}

/** High para is T1 to T8 (the owner, 2026-10-15); anything lower is low para. */
const HIGH_PARA_LOWEST = 8;

function highPara(level: ExactLevel): boolean {
  const t = thoracic(level);
  return t !== null && t <= HIGH_PARA_LOWEST;
}

/**
 * The levels worth offering for each answer: a quad's (and a central cord's)
 * in the neck, a high para's T1 to T8, a low para's T9 down, an old para's T1
 * down, and every level otherwise. "Do not know" is always last.
 */
export function levelsForType(type: InjuryType | null): ExactLevel[] {
  const all = EXACT_LEVELS.filter((l) => l !== 'Do not know');
  const neck = (l: ExactLevel) => l.startsWith('C');
  const chosen =
    type === 'quad' || type === 'central_cord'
      ? all.filter(neck)
      : type === 'high_para'
        ? all.filter(highPara)
        : type === 'low_para'
          ? all.filter((l) => !neck(l) && !highPara(l))
          : type === 'para'
            ? all.filter((l) => !neck(l))
            : all;
  return [...chosen, 'Do not know'];
}

/** A relative or a professional: a member with no injury of their own to describe. */
export function hasNoInjury(type: InjuryType | null): boolean {
  return type === 'family' || type === 'professional';
}

/** Whether the level is asked: of anybody with an injury. A condition's is optional. */
export function asksLevel(type: InjuryType | null): boolean {
  return type !== null && !hasNoInjury(type);
}

/** Central cord syndrome, typed or chosen, is in the neck and always incomplete. */
export function isCentralCord(conditionName: string): boolean {
  return /central\s*cord/i.test(conditionName);
}

/**
 * A condition's levels (the owner, 2026-10-20): the neck for central cord
 * syndrome, every level otherwise. No "Do not know": the form's own first
 * choice, "Not applicable", covers it and is where it starts.
 */
export function levelsForCondition(conditionName: string): ExactLevel[] {
  return levelsForType(isCentralCord(conditionName) ? 'central_cord' : 'condition').filter(
    (l) => l !== 'Do not know',
  );
}

/** Where a member lives, "San Jose, CA", or null with no city (the owner, 2026-10-30). */
export function cityAndState(member: {
  city: string | null;
  state?: string | null;
}): string | null {
  if (!member.city) return null;
  return member.state ? `${member.city}, ${member.state}` : member.city;
}

/**
 * How somebody's disability reads in a line: "T6", "C5 central cord",
 * "Transverse myelitis", "High para", "Family / friend", "Staff". One function, so a
 * card, a post and an event's list say the same thing about the same person.
 */
export function injuryLabel(member: {
  injuryType: InjuryType | null;
  conditionName: string | null;
  exactLevel: string | null;
  levelRange: string | null;
}): string {
  const level = member.exactLevel && member.exactLevel !== 'Do not know' ? member.exactLevel : null;
  switch (member.injuryType) {
    case 'family':
      return 'Family / friend';
    case 'professional':
      return 'Staff';
    case 'condition': {
      const name = member.conditionName ?? 'Other disability';
      return level ? `${name} · ${level}` : name;
    }
    case 'central_cord':
      return level ? `${level} central cord` : 'Central cord syndrome';
    case 'high_para':
      return level ?? 'High para';
    case 'low_para':
      return level ?? 'Low para';
    case 'para':
      return level ?? 'Para';
    case 'quad':
      return level ?? 'Quad';
    default:
      return level ?? member.levelRange ?? 'Not sure yet';
  }
}

/**
 * A starting answer for somebody who gave a level before the kind was asked:
 * a neck level reads as quad, T1 to T8 as high para, any lower as low para.
 * Only ever a form's default, never written without the member saving it.
 */
export function typeForLevel(level: ExactLevel | null): InjuryType | null {
  if (!level || level === 'Do not know') return null;
  if (level.startsWith('C')) return 'quad';
  return highPara(level) ? 'high_para' : 'low_para';
}

/**
 * Whether "complete or incomplete" belongs to this answer: an injury with a
 * level. Not another disability, a central cord (incomplete by definition) or
 * a relative or a professional.
 */
export function asksCompleteness(type: InjuryType | null): boolean {
  return type !== 'condition' && type !== 'central_cord' && !hasNoInjury(type);
}

export const COMPLETENESS = ['Complete', 'Incomplete', 'Do not know'] as const;
export type Completeness = (typeof COMPLETENESS)[number];

/**
 * How precisely somebody gave their date of injury. Stored so nothing ever displays more precision
 * than was actually offered — "injured 2013", never a fabricated "1 March 2013". Year-only is a
 * normal answer, not a skip (CONTEXT.md).
 */
export const DATE_PRECISIONS = ['day', 'month', 'year'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/* ------------------------------------------------------------- life and kit */

export const INDEPENDENCE = [
  'Completely independent',
  /** Not one of the survey's options — it comes from the NorCal SCI directory,
   *  where people described themselves this way. Kept rather than flattened. */
  'Mostly independent',
  'Partially independent',
  'Partially dependent',
  'Completely dependent',
] as const;
export type Independence = (typeof INDEPENDENCE)[number];

export const EMPLOYMENT = [
  'Full time',
  'Part time',
  'Student',
  'Retired',
  'Seeking work',
  'Not currently working',
] as const;
export type Employment = (typeof EMPLOYMENT)[number];

export const EDUCATION = [
  'High school / GED',
  'Some college',
  "Associate's degree",
  "Bachelor's degree",
  "Master's degree",
  'PhD, MD, JD or similar',
  'In progress',
] as const;
export type Education = (typeof EDUCATION)[number];

/** Asked about education and children alike: before the injury, after it, or both. */
export const BEFORE_AFTER = ['Before', 'After', 'Both'] as const;
export type BeforeAfter = (typeof BEFORE_AFTER)[number];

export const MARITAL_STATUS = [
  'Single',
  'Married or partnered',
  'Divorced or separated',
  'Widowed',
] as const;
export type MaritalStatus = (typeof MARITAL_STATUS)[number];

/* ------------------------------------------------------------------ member */

/* ---------------------------------------------------------------- location */

/**
 * States, as the two-letter codes the `state` column holds. All fifty plus DC:
 * the club is Northern California today, but somebody moves, and a list that
 * cannot express where they live is a worse problem than a long dropdown.
 */
export const US_STATES = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
] as const;

export type UsStateCode = (typeof US_STATES)[number][0];

export function stateNameFor(code: string): string | null {
  return US_STATES.find(([c]) => c === code)?.[1] ?? null;
}

export function stateCodeForName(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return US_STATES.find(([, n]) => n.toLowerCase() === wanted)?.[0] ?? null;
}

/* ------------------------------------------------------------------ member */

export const MEMBER_TYPES = ['peer', 'mentor', 'organization'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export function memberType(value: unknown): MemberType {
  return value === 'organization' ? 'organization' : value === 'mentor' ? 'mentor' : 'peer';
}

/**
 * Membership can be lost — see CONTEXT.md. `suspended` and `removed` both drop somebody out
 * of `browse_members`; the difference is whether it is reversible.
 */
export const MEMBER_STATUSES = ['active', 'suspended', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * A member as anybody other than themselves can see them: the `browse_members` projection.
 *
 * `phone` and `birthDate` are absent by construction, not by omission. The database view makes the
 * same cut in SQL, so neither this type nor that view is load-bearing on its own.
 */
/** An administrator-linked organization identity, read with the visible profile. */
export type RepresentedOrganization = Pick<Organization, 'id' | 'name' | 'shortCode' | 'logoPath'>;

export interface BrowseMember {
  id: string;
  type: MemberType;
  displayName: string;
  /** The @name, without the "@". Null only for a member who joined before usernames. */
  username: string | null;
  /** Path inside the `photos` bucket, not a URL. `usePhotoUrl()` signs one,
   *  so the project ref is never baked into the data. */
  photoPath: string | null;
  photoAlt: string | null;
  avatarColor: string | null;

  city: string | null;
  state: string;

  levelRange: LevelRange;
  exactLevel: ExactLevel | null;
  /** Null before 20261015000000, or for somebody who would rather not say. */
  injuryType: InjuryType | null;
  /** Only with injuryType 'condition': in the member's words. */
  conditionName: string | null;
  completeness: Completeness;
  /** Null where its member does not show it (20261117030000), but to themselves. */
  injuryDate: string | null;
  injuryDatePrecision: DatePrecision | null;
  /** How long ago, sent whether or not the date is (src/lib/injury.ts). */
  injuryStage: InjuryStage | null;
  /** The finer band, for the colour (20261118226000). */
  injuryBand: InjuryBand | null;
  region: InjuryRegion;
  /** Derived on read, never stored — a stored age is wrong within a year. */
  age: number | null;

  howInjured: string | null;
  bio: string | null;
  detail: string | null;

  gender: string | null;
  languages: string[];
  independence: Independence | null;
  employment: Employment | null;
  fieldOfWork: string | null;
  /** Free text, not `Education`. That enum is the survey picker's options; the
   *  column holds whatever somebody wrote ("Master's in Nursing Leadership"). */
  education: string | null;
  educationWhen: BeforeAfter | null;
  maritalStatus: MaritalStatus | null;
  hasChildren: boolean | null;
  childrenWhen: BeforeAfter | null;

  /** Capped at three, so the ones chosen actually mean something. */
  interests: string[];
  /** "Ask me about" — the field members search on most. */
  topics: string[];
  /** Devices and procedures somebody is willing to discuss. */
  selfCare: string[];
  /** Adaptive sports equipment owned, in the member's words. */
  sportsEquipment: string | null;
  /** Grants received, in the member's words. */
  grants: string | null;

  affiliations: string[];
  /** Org admin of these ("Org admin" in the app); distinct from self-described affiliations. */
  representedOrganizations: RepresentedOrganization[];
  /** The organizations that made this member a mentor (20261028000000), the club's last. */
  mentorOrganizations: RepresentedOrganization[];
  /** Null until the survey asks. Not the same as a no. */
  wantsToMentor: boolean | null;
  /** Seeded from the NorCal SCI directory rather than entered by the member. */
  isSeed: boolean;
  /** The club's own account. Shown as official; grants nothing on its own. */
  isAdmin: boolean;
  createdAt: string;
}

/** The viewer's own row, which does carry the two fields `BrowseMember` refuses to. */
export interface OwnMember extends BrowseMember {
  phone: string;
  birthDate: string;
  status: MemberStatus;
  showInBrowse: boolean;
  invitedBy: string | null;
}

/* ------------------------------------------------------------------ invite */

/**
 * One phone number placed on the list. `pending` until it is used; `consumed` once an account
 * exists behind it. Revoking a pending invite takes it off the list.
 */
export const INVITE_STATUSES = ['pending', 'consumed', 'revoked'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface Invite {
  id: string;
  /** E.164. Normalized on write so a lookup cannot miss on formatting. */
  phone: string;
  status: InviteStatus;
  invitedByMemberId: string | null;
  invitedByOrganizationId: string | null;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

/* ------------------------------------------------------------ organization */

export interface Organization {
  id: string;
  /** One line for its card (20261101120000). */
  summary?: string | null;
  /** Join asks its org admins, instead of making a member (20261031010000). */
  joinsNeedApproval?: boolean;
  /** Its imported events take RSVPs too (20261101080000). */
  collectsRsvps?: boolean;
  /** Whether a review of it can be anonymous (20261031080000). */
  anonymousReviews?: boolean;
  /** Two or three letters, for the badge on a mentor's card. */
  shortCode: string;
  name: string;
  city: string;
  description: string;
  tags: string[];
  /** Whether this organization can put numbers on the list. */
  canInvite: boolean;
  /**
   * Path within the `photos` bucket, or null to fall back to the
   * short-code badge. Not a URL — `usePhotoUrl()` signs one, so the data
   * stays portable between projects. See
   * supabase/migrations/20260911260000_organization_logos_to_storage.sql.
   */
  logoPath: string | null;
  /** Two letters, only as its own site gives it; none keeps it off the map. */
  state?: string | null;
  /** What kind it is, for its pin (20261101030000). */
  category?: OrganizationCategory | null;
  /** Where it is, main place first (20261025015000). */
  places?: OrganizationPlace[];
}

/** One of an organization's places. `address` only for a public place. */
export interface OrganizationPlace {
  id: string;
  position: number;
  label: string | null;
  address: string | null;
  city: string;
  state: string;
  /** 12345 or 12345-6789; null when not given (20261028700000). */
  postalCode: string | null;
  /** Who to contact there, as its own page says (20261103030000). */
  note?: string | null;
  /** Its own page. */
  url?: string | null;
}

/* ------------------------------------------------------------------ browse */

export const PEERS_SEGMENTS = ['everyone', 'mentors'] as const;
export type PeersSegment = (typeof PEERS_SEGMENTS)[number];

export interface MemberFilters {
  regions: InjuryRegion[];
  /**
   * Members with a spinal cord condition (20261015000000), in the same group
   * as the regions: either matches. Its own field, not a region, because a
   * condition with a level is in a region as well.
   */
  condition: boolean;
  /** Mentors, the members who are not, or everybody. */
  role: 'any' | 'mentors' | 'peers';
  /** An organization's name, from the members in the list; null for any. */
  organization: string | null;
  /** From the member's own city, as the map places everybody; null for any distance. */
  withinMiles: number | null;
  topics: string[];
  /** Age groups (AGE_BANDS in peers/filters.ts); any one matches. */
  ages: string[];
  /** Who is left out of the deck (LEAVE_OUT in peers/filters.ts). */
  leaveOut: PeersLeftOut[];
  search: string;
}

/**
 * Who can be left out of Peers: members with SCI/D themselves, those without
 * (staff, family & friends), those unsure of their level, org admins. Mentors
 * have their own tab, so no chip (the owner, 2026-11-18).
 */
export const PEERS_LEFT_OUT = [
  'sciPeers',
  'professionals',
  'family',
  'unsure',
  'orgAdmins',
] as const;
export type PeersLeftOut = (typeof PEERS_LEFT_OUT)[number];

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  regions: [],
  condition: false,
  role: 'any',
  organization: null,
  withinMiles: null,
  topics: [],
  ages: [],
  leaveOut: [],
  search: '',
};

/**
 * Where Peers starts, and what Clear goes back to (the owner, 2026-11-12):
 * professionals and family left out, so the deck is members with SCI/D.
 * Those unsure of their level were left out too from 2026-11-15, and are in
 * again: they are members with SCI/D (the owner, 2026-11-24: "We should not
 * filter unsure of level on peers tab by default"). Their chip stays.
 */
export const DEFAULT_MEMBER_FILTERS: MemberFilters = {
  ...EMPTY_MEMBER_FILTERS,
  leaveOut: ['professionals', 'family'],
};

/* ------------------------------------------------------------------ events */

/**
 * An event on the club's calendar.
 *
 * Ingested from a partner organization's own calendar, never written in the
 * app — there is no "create an event" screen and no plan for one. Events are
 * the club's public surface (CONTEXT.md, "What is public"), which is why
 * this type has no field that identifies a member: who is going is
 * `EventAttendee`, and it is answered by a different, members-only query.
 *
 * `latitude` and `longitude` exist on the table and are deliberately absent
 * here. The browser is not granted the column privilege, so a field for them
 * would be one nobody could ever fill.
 */
export const EVENT_FORMATS = ['in_person', 'online', 'hybrid'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const EVENT_FORMAT_LABELS: Record<EventFormat, string> = {
  in_person: 'In person',
  online: 'Online',
  hybrid: 'Hybrid',
};

export interface EventTag {
  slug: string;
  name: string;
  /** The parent category, for grouping in the filter sheet. */
  categorySlug: string;
  categoryName: string;
}

/**
 * Who in the club sees an event (the owner, 2026-10-22, 20261022180000): the
 * whole club, the hosting organization's followers, or the members of chosen
 * group chats. Every event also has a page anyone with its link can open
 * (20261029110000), so "anyone with the link" is no longer a choice.
 */
/**
 * `followers` is the hosting organization's members; `organizations` the
 * members of the ones chosen; `people` invite only (20261106030000). The last
 * three are private in the club; only `people` is closed to its link too
 * (20261114050000).
 */
export const EVENT_AUDIENCES = ['club', 'followers', 'groups', 'organizations', 'people'] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export interface ClubEvent {
  id: string;
  title: string;
  /** Plain text, for the card and for search. */
  description: string;
  /** Sanitized HTML with absolute links, for the detail view. */
  descriptionHtml: string;
  accessDetails?: string | null;
  /** A sentence or two for a card (20261031140000). A card without one shows no words. */
  detailSummary?: string | null;
  /** ISO 8601. Always present — an event with no start time is not ingested. */
  startTime: string;
  endTime: string | null;
  /**
   * The IANA zone the event's times should be *read* in, from its feed.
   *
   * A calendar entry means a wall-clock time at a place: a ride that starts at
   * 9am in Santa Cruz starts at 9am whether the member reading about it is in
   * San Jose or in London. Formatting in the viewer's own zone would quietly
   * restate it as 5pm for the traveller, so every date on this flow is
   * formatted in this zone instead.
   *
   * The event's own zone when its source states one, else its feed's
   * (20261021000000): a national feed's in-person events carry their own.
   */
  timezone: string;
  /** Dates without hours: the first day's midnight to the last day's 23:59. */
  allDay: boolean;
  /** Two-letter state of an in-person event; null online or unknown. */
  state: string | null;
  /** Free text venue, exactly as the feed wrote it. */
  location: string;
  city: string | null;
  url: string | null;
  registrationUrl: string | null;
  /** The video call its organizer gave (20261106070000); read only for one event's own page. */
  meetingUrl?: string | null;
  /** Its ZIP code (20261121040000); read only for one event's own page. */
  postalCode?: string | null;
  /** The address after thesciclub.com/e/; read only for one event's own page. */
  shortLink?: string | null;
  /**
   * The repeating event this is one occurrence of, or null for a one-off.
   *
   * Identity, computed at ingest by jobs/event-ingest/series.js and stored —
   * never recomputed in the client, and never matched on in SQL, so there is
   * one implementation of what counts as "the same event".
   */
  seriesId: string | null;
  /** Null means the ingest job could not tell, which is not the same as in person. */
  format: EventFormat | null;
  /** Set only when the host is an organization the club already has. */
  organizationId: string | null;
  /** The feed's own name for the host, when it is not a club organization. */
  hostName: string | null;
  /** Organizations hosting it beside organizationId (20261105170000). */
  cohostIds: string[];
  /**
   * Added in the app by an administrator or a member who speaks for its
   * organization, rather than read from a calendar. Only these can be changed
   * or deleted here; a scraped one is changed on its organization's own site.
   */
  handAdded: boolean;
  /** The cover picture in the photos bucket, for an event added by hand (20261011070000). */
  photoPath: string | null;
  /** What a screen reader says for the cover picture. */
  photoAlt: string | null;
  /** The pictures besides the cover (20261031060000). Not in a list's read. */
  morePhotos?: { path: string; alt: string }[];
  /** Who can see it (20261022180000). */
  audience: EventAudience;
  /**
   * On an imported event, the fields an administrator changed
   * (`title`, `start_time`, …); empty when it reads as its calendar has it.
   */
  adminChanged: string[];
  /** What the organization's calendar says for exactly those fields. */
  calendarValues: Record<string, unknown> | null;
  tags: EventTag[];
  goingCount: number;
  interestedCount: number;
}

export const RSVP_STATUSES = ['interested', 'going'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

/**
 * A member who has RSVPed, as one other member sees them.
 *
 * Read from `event_attendees`, which joins through `browse_members` — so this
 * only ever describes somebody who is in the club, in good standing, and has
 * not opted out of being browsed. A member who opted out still counts towards
 * `ClubEvent.goingCount`; they just have no row here.
 */
export interface EventAttendee {
  memberId: string;
  status: RsvpStatus;
  displayName: string;
  photoPath: string | null;
  photoAlt: string | null;
  avatarColor: string | null;
  city: string | null;
  levelRange: string;
  exactLevel: string | null;
  injuryType: InjuryType | null;
  conditionName: string | null;
  type: MemberType;
}

/** The segment pills across the top of the Events tab, from the mock's `evPage()`. */
/**
 * Every segment the URL will accept.
 *
 * The chip row in events/page.tsx is a separate list, and was deliberately
 * shorter for a while — `been-to` had no pill and was reached only from the
 * counter on Me. That made the third of three related answers the one a member
 * had to already know about, so it is a pill like the other two now. The two
 * lists still differ in principle: a segment can be linkable without being
 * offered.
 */
export const EVENTS_SEGMENTS = [
  'upcoming',
  'going',
  'interested',
  'been-to',
  'sport',
  'online',
  'orgs',
] as const;
export type EventsSegment = (typeof EVENTS_SEGMENTS)[number];

/**
 * How far ahead the list looks. `past` is the only one that looks backwards.
 *
 * Both forward windows are rolling counts of days from today, and they are
 * named for what they are. An earlier version called them "This week" and
 * "This month", where the first was a rolling seven days but the second ran to
 * the end of the calendar month — so the default view shrank as the month went
 * on, and on the 30th showed a single day while a full next month sat just
 * outside it. Two adjacent options cannot mean two different things, and the
 * one that degrades must not be the default.
 */
export const DATE_WINDOWS = ['next7', 'next30', 'any', 'past'] as const;
export type DateWindow = (typeof DATE_WINDOWS)[number];

export const DATE_WINDOW_LABELS: Record<DateWindow, string> = {
  next7: 'Next 7 days',
  next30: 'Next 30 days',
  any: 'Any time',
  past: 'Past events',
};

export interface EventFilters {
  when: DateWindow;
  formats: EventFormat[];
  /** Tag slugs. Selected tags are OR-ed: an event matching any of them is in. */
  tags: string[];
  cities: string[];
  /** Organization ids. */
  organizations: string[];
  /** What kind of organization hosts it (organization-categories.ts), the owner, 2026-11-03. */
  hostTypes: string[];
  /** Miles from home an event may be (an online one: its host); null for any distance. */
  withinMiles: number | null;
}

/** The owner, 2026-10-31: the list shows what is within 50 miles, unless widened. */
export const DEFAULT_WITHIN_MILES = 50;

export const EMPTY_EVENT_FILTERS: EventFilters = {
  when: 'next30',
  formats: [],
  tags: [],
  cities: [],
  organizations: [],
  hostTypes: [],
  withinMiles: DEFAULT_WITHIN_MILES,
};
