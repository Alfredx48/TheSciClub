import { useContext, useEffect, useRef, useState } from 'react';
import { AccountContext } from '@/lib/account-context';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { toInjuryBand } from '@/lib/injury';
import { useKeptRead, useTabReadVersion } from '@/lib/kept-reads';
import { columnsOf, readOwnRow } from '@/lib/own-row';
import { readPages } from '@/lib/read-pages';
import {
  holdFacesFresh,
  onDirectoryChanged,
  onFacesStale,
  onForgetSharedReads,
  onPhotoBroke,
} from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';
import {
  type BrowseMember,
  INJURY_STAGES,
  type InjuryType,
  type MemberType,
  memberType,
  type RepresentedOrganization,
} from '@/types/domain';

/**
 * Reading members.
 *
 * Everything goes through `browse_members`, which is the only projection
 * through which one member sees another — it does not select `phone` or
 * `birth_date` at all, and it is granted to `authenticated` only. Nothing here
 * queries `members` directly; own-row-only RLS would return a single row.
 *
 * The row shape is snake_case from Postgres and camelCase in the app, so the
 * mapping happens once, here, rather than in every component.
 */

export interface BrowseMemberRow {
  id: string;
  type: string;
  display_name: string;
  /** Optional: absent from a database before 20261012000000. */
  username?: string | null;
  photo_path: string | null;
  photo_alt: string | null;
  avatar_color?: string | null;
  city: string | null;
  state: string;
  level_range: string;
  exact_level: string | null;
  /** Optional: absent from a database before 20261015000000. */
  injury_type?: string | null;
  condition_name?: string | null;
  completeness: string;
  injury_date: string | null;
  injury_date_precision: string | null;
  /** Optional: absent from a database before 20261117030000. */
  injury_stage?: string | null;
  /** Optional: absent from a database before 20261118226000. */
  injury_band?: number | null;
  region: string;
  age: number | null;
  /** This and the other optional answers: not in a list's read (DECK_COLUMNS). */
  how_injured?: string | null;
  bio?: string | null;
  detail?: string | null;
  gender?: string | null;
  languages?: string[] | null;
  independence?: string | null;
  employment?: string | null;
  field_of_work: string | null;
  education?: string | null;
  education_when?: string | null;
  marital_status?: string | null;
  has_children?: boolean | null;
  children_when?: string | null;
  interests: string[] | null;
  topics: string[] | null;
  self_care?: string[] | null;
  /** Optional: absent from a database before 20261011040000. */
  sports_equipment?: string | null;
  grants?: string | null;
  affiliations: string[] | null;
  represented_organizations?:
    | {
        id: string;
        name: string;
        short_code: string;
        logo_path: string | null;
      }[]
    | null;
  mentor_organizations?: OrganizationRow[] | null;
  wants_to_mentor?: boolean | null;
  is_seed?: boolean;
  is_admin: boolean;
  created_at: string;
}

/** An organization as a member's badge carries it: browse_members' jsonb. */
interface OrganizationRow {
  id: string;
  name: string;
  short_code: string;
  logo_path: string | null;
}

export function toOrganizationMark(row: OrganizationRow): RepresentedOrganization {
  return { id: row.id, name: row.name, shortCode: row.short_code, logoPath: row.logo_path };
}

/**
 * What a screen reads (the owner's speed report, 2026-11-03). The long
 * answers in a member's own words, and the profile's other answers, are left
 * to their own page, which reads them by id.
 *
 * A deck (Peers, Home, the map) draws cards, ranks, searches and filters:
 * these columns and no others are used there.
 */
const DECK_COLUMNS =
  'id, type, display_name, username, photo_path, photo_alt, city, state, level_range, exact_level, injury_type, condition_name, completeness, injury_date, injury_date_precision, injury_stage, injury_band, region, age, field_of_work, interests, topics, affiliations, is_admin, created_at, represented_organizations, mentor_organizations';

/** A picker (new message, groups, share) draws a face, a name and a line. */
const NAMES_COLUMNS =
  'id, type, display_name, username, photo_path, photo_alt, city, state, level_range, exact_level, injury_type, condition_name';

/** The one row -> domain mapping. Exported so nothing writes a second one. */
export function toMember(row: BrowseMemberRow): BrowseMember {
  return {
    id: row.id,
    type: memberType(row.type),
    displayName: row.display_name,
    username: row.username ?? null,
    photoPath: row.photo_path,
    photoAlt: row.photo_alt,
    avatarColor: row.avatar_color ?? null,
    city: row.city,
    state: row.state,
    levelRange: row.level_range as BrowseMember['levelRange'],
    exactLevel: row.exact_level as BrowseMember['exactLevel'],
    injuryType: (row.injury_type ?? null) as BrowseMember['injuryType'],
    conditionName: row.condition_name ?? null,
    completeness: row.completeness as BrowseMember['completeness'],
    injuryDate: row.injury_date,
    injuryDatePrecision: row.injury_date_precision as BrowseMember['injuryDatePrecision'],
    injuryStage: INJURY_STAGES.find((stage) => stage === row.injury_stage) ?? null,
    injuryBand: toInjuryBand(row.injury_band),
    region: row.region as BrowseMember['region'],
    age: row.age,
    howInjured: row.how_injured ?? null,
    bio: row.bio ?? null,
    detail: row.detail ?? null,
    gender: row.gender ?? null,
    languages: row.languages ?? [],
    independence: (row.independence ?? null) as BrowseMember['independence'],
    employment: (row.employment ?? null) as BrowseMember['employment'],
    fieldOfWork: row.field_of_work,
    education: row.education ?? null,
    educationWhen: (row.education_when ?? null) as BrowseMember['educationWhen'],
    maritalStatus: (row.marital_status ?? null) as BrowseMember['maritalStatus'],
    hasChildren: row.has_children ?? null,
    childrenWhen: (row.children_when ?? null) as BrowseMember['childrenWhen'],
    interests: row.interests ?? [],
    topics: row.topics ?? [],
    selfCare: row.self_care ?? [],
    sportsEquipment: row.sports_equipment ?? null,
    grants: row.grants ?? null,
    affiliations: row.affiliations ?? [],
    representedOrganizations: (row.represented_organizations ?? []).map(toOrganizationMark),
    mentorOrganizations: (row.mentor_organizations ?? []).map(toOrganizationMark),
    wantsToMentor: row.wants_to_mentor ?? null,
    // Read on a member's own page only.
    isSeed: row.is_seed ?? false,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
  };
}

export interface MembersState {
  members: BrowseMember[];
  loading: boolean;
  /** The database's own sentence where there is one — not a rewritten summary. */
  error: string | null;
  /**
   * No session, as opposed to a failed query. Kept separate because they are
   * different screens: "permission denied for view browse_members" is an
   * accurate thing to show a developer and a useless thing to show a member.
   */
  signedOut: boolean;
}

/** Which screen asks: a deck's columns, or a picker's names. */
export type DirectoryUse = 'deck' | 'names';

/** A kept read older than this is read again, behind it, when a screen opens. */
export const DIRECTORY_FRESH_MS = 60_000;

type DirectoryRead = { members: BrowseMember[]; error: null } | { members: null; error: string };

/**
 * The directory, read once and shared by every screen, for one signed-in
 * member. Forgotten at sign-out and on a switch (shared-reads.ts), and when
 * this device changes who it may see (a block, its own profile).
 */
interface HeldDirectory {
  userId: string;
  use: DirectoryUse;
  read: Promise<DirectoryRead>;
  reading: boolean;
  value?: BrowseMember[];
  at?: number;
}
let heldDirectory: HeldDirectory | null = null;

function forgetDirectory() {
  heldDirectory = null;
}
onForgetSharedReads(forgetDirectory);

/** Screens showing the directory, told to read it again. */
const directoryWatchers = new Set<() => void>();
const tellWatchers = () => {
  for (const watcher of directoryWatchers) watcher();
};
/** Screens showing the directory, told to draw the kept read as patched. */
const directoryRedrawers = new Set<() => void>();
onDirectoryChanged(() => {
  forgetDirectory();
  tellWatchers();
});

/**
 * After a broken photo or a page shown again (shared-reads.ts): only ids and
 * photos, one read for every screen, the kept read patched if one moved.
 */
let probing = false;
async function probePhotos(): Promise<void> {
  const held = heldDirectory;
  if (probing || !held?.value || held.reading || directoryRedrawers.size === 0) return;
  // A call, so the type checker does not narrow it across the await.
  const current = () => heldDirectory === held && !held.reading;
  probing = true;
  try {
    const { data, error } = await readPages<
      Pick<BrowseMemberRow, 'id' | 'photo_path' | 'photo_alt'>
    >((from, to) =>
      getSupabase()
        .from('browse_members')
        .select('id, photo_path, photo_alt')
        .order('display_name')
        .order('id')
        .range(from, to),
    );
    const members = held.value;
    if (error || !data || !current()) return;
    const now = new Map(data.map((row) => [row.id, row]));
    const next = members.map((member) => {
      const row = now.get(member.id);
      return !row || (row.photo_path === member.photoPath && row.photo_alt === member.photoAlt)
        ? member
        : { ...member, photoPath: row.photo_path, photoAlt: row.photo_alt };
    });
    if (next.every((member, i) => member === members[i])) return;
    held.value = next;
    held.read = Promise.resolve({ members: next, error: null });
    // Redrawn, not read: a stale deck is not read again for a photo.
    for (const redraw of directoryRedrawers) redraw();
  } catch {
    // Offline: the next broken photo or return asks again.
  } finally {
    probing = false;
  }
}
// Another member's photo may have changed: a photo broke, or the page is back.
onPhotoBroke(() => {
  void probePhotos();
});
onFacesStale(() => {
  void probePhotos();
});

/** A deck's read serves a picker too; not the other way round. */
const covers = (held: HeldDirectory, use: DirectoryUse) => held.use === 'deck' || use === 'names';

async function fetchDirectory(use: DirectoryUse): Promise<DirectoryRead> {
  try {
    const supabase = getSupabase();
    // One type for both: a names read leaves the deck's other columns unset.
    const columns = (use === 'deck' ? DECK_COLUMNS : NAMES_COLUMNS) as typeof DECK_COLUMNS;
    // Every page: the API stops at 1,000 rows without saying so. `id`
    // breaks ties so two members with one name are not skipped or doubled.
    const { data, error } = await readPages<BrowseMemberRow>((from, to) =>
      supabase
        .from('browse_members')
        .select(columns)
        .order('display_name')
        .order('id')
        .range(from, to),
    );
    if (error) return { members: null, error: describeError(error, 'Could not load members.') };
    return { members: (data ?? []).map(toMember), error: null };
  } catch (e) {
    return { members: null, error: describeThrown(e, 'Could not load members.') };
  }
}

/** `again`: a fresh read, the last answer kept until it lands. */
function readDirectory(userId: string, use: DirectoryUse, again: boolean): Promise<DirectoryRead> {
  const held = heldDirectory?.userId === userId ? heldDirectory : null;
  if (held && covers(held, use) && (!again || held.reading)) return held.read;
  const wanted: DirectoryUse = held?.use === 'deck' ? 'deck' : use;
  const entry: HeldDirectory = { userId, use: wanted, read: fetchDirectory(wanted), reading: true };
  if (held?.value && held.use === wanted) {
    entry.value = held.value;
    entry.at = held.at ?? 0;
  }
  heldDirectory = entry;
  void entry.read.then((result) => {
    entry.reading = false;
    if (result.error === null) {
      entry.value = result.members;
      entry.at = Date.now();
    } else if (heldDirectory === entry) {
      // A failed refresh keeps the last answer; a failed first read is not kept.
      if (entry.value) entry.read = Promise.resolve({ members: entry.value, error: null });
      else heldDirectory = null;
    }
  });
  return entry.read;
}

function keptFor(userId: string | null, use: DirectoryUse): MembersState | null {
  const held = userId !== null && heldDirectory?.userId === userId ? heldDirectory : null;
  return held?.value && covers(held, use)
    ? { members: held.value, loading: false, error: null, signedOut: false }
    : null;
}

const isFresh = (userId: string) =>
  heldDirectory?.userId === userId && Date.now() - (heldDirectory.at ?? 0) <= DIRECTORY_FRESH_MS;

const LOADING: MembersState = { members: [], loading: true, error: null, signedOut: false };

/**
 * The members Peers shows, from the read shared between screens. A screen
 * opened within a minute of the last read draws it as it is; later, it draws
 * it and reads again behind it.
 */
export function useBrowseMembers(use: DirectoryUse = 'deck'): MembersState {
  const knownUser = useContext(AccountContext)?.userId ?? null;
  const tabVersion = useTabReadVersion();
  const readTabVersion = useRef(0);
  const [state, setState] = useState<MembersState>(() => keptFor(knownUser, use) ?? LOADING);
  // Bumped when the kept read is let go or goes stale, so this screen reads again.
  const [round, setRound] = useState(0);
  useEffect(() => {
    const watcher = () => {
      setRound((n) => n + 1);
    };
    const redraw = () => {
      setState((now) => {
        const held = heldDirectory;
        if (now.signedOut || !held?.value || now.members === held.value || !covers(held, use)) {
          return now;
        }
        return { members: held.value, loading: false, error: null, signedOut: false };
      });
    };
    directoryWatchers.add(watcher);
    directoryRedrawers.add(redraw);
    const release = holdFacesFresh();
    return () => {
      directoryWatchers.delete(watcher);
      directoryRedrawers.delete(redraw);
      release();
    };
  }, [use]);

  useEffect(() => {
    let cancelled = false;
    // A call, so the type checker does not narrow it to false after an await.
    const gone = () => cancelled;
    const settle = (next: MembersState) => {
      setState((now) =>
        now.members === next.members &&
        now.loading === next.loading &&
        now.error === next.error &&
        now.signedOut === next.signedOut
          ? now
          : next,
      );
    };

    async function load() {
      try {
        // Ask before knocking. Without this, a signed-out visitor gets the
        // database's refusal rendered at them verbatim.
        const { data: sessionData } = await getSupabase().auth.getSession();
        if (gone()) return;
        const session = sessionData.session;
        if (!session) {
          settle({ members: [], loading: false, error: null, signedOut: true });
          return;
        }
        const userId = session.user.id;
        const kept = keptFor(userId, use);
        if (kept) settle(kept);
        if (kept && isFresh(userId) && readTabVersion.current === tabVersion) return;
        const result = await readDirectory(userId, use, kept !== null);
        if (gone()) return;
        readTabVersion.current = tabVersion;
        if (result.error === null) {
          settle({ members: result.members, loading: false, error: null, signedOut: false });
        } else if (!kept) {
          settle({ members: [], loading: false, error: result.error, signedOut: false });
        }
      } catch (e) {
        if (gone()) return;
        settle({
          members: [],
          loading: false,
          error: describeThrown(e, 'Could not load members.'),
          signedOut: false,
        });
      }
    }

    if (round < 0) return;
    void load();
    return () => {
      cancelled = true;
    };
  }, [use, round, tabVersion]);

  return state;
}

/**
 * One member, by id.
 *
 * Fetches rather than reading from a loaded deck, so a profile opens correctly
 * on a direct link or a refresh — the deck is not guaranteed to be in memory.
 * `notFound` is distinct from an error: somebody whose membership ended, or a
 * stale link, is not a failure to report.
 */
export interface MemberState {
  member: BrowseMember | null;
  loading: boolean;
  error: string | null;
  signedOut: boolean;
  notFound: boolean;
}

/** Profiles open, told to read their one row again for a changed photo. */
const memberWatchers = new Set<() => void>();
const tellMemberWatchers = () => {
  for (const watcher of memberWatchers) watcher();
};
onPhotoBroke(tellMemberWatchers);
onFacesStale(tellMemberWatchers);

export function useBrowseMember(id: string | undefined): MemberState {
  const [state, setState] = useState<MemberState>({
    member: null,
    loading: true,
    error: null,
    signedOut: false,
    notFound: false,
  });
  // Bumped to read the row again, behind what is shown.
  const [round, setRound] = useState(0);
  // The id whose row is drawn: a re-read of it changes only a found row.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const watcher = () => {
      setRound((n) => n + 1);
    };
    memberWatchers.add(watcher);
    const release = holdFacesFresh();
    return () => {
      memberWatchers.delete(watcher);
      release();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const aborted = () => signal.aborted;
    if (round < 0) return;
    const again = id !== undefined && shown.current === id;

    // Only the photo, and only a found row changes: what is shown stays up.
    async function refreshPhoto(memberId: string, signal: AbortSignal) {
      const result = await getSupabase()
        .from('browse_members')
        .select('id, photo_path, photo_alt')
        .eq('id', memberId)
        .abortSignal(signal)
        .maybeSingle();
      const row = result.data as Pick<BrowseMemberRow, 'photo_path' | 'photo_alt'> | null;
      if (signal.aborted || result.error || !row) return;
      setState((now) =>
        now.member?.id === memberId &&
        (now.member.photoPath !== row.photo_path || now.member.photoAlt !== row.photo_alt)
          ? {
              ...now,
              member: { ...now.member, photoPath: row.photo_path, photoAlt: row.photo_alt },
            }
          : now,
      );
    }

    async function load() {
      if (!id) {
        setState({ member: null, loading: false, error: null, signedOut: false, notFound: true });
        return;
      }
      try {
        const supabase = getSupabase();
        const { data: sessionData } = await supabase.auth.getSession();
        if (aborted()) return;
        if (again) {
          await refreshPhoto(id, signal);
          return;
        }
        if (!sessionData.session) {
          setState({
            member: null,
            loading: false,
            error: null,
            signedOut: true,
            notFound: false,
          });
          return;
        }

        // Taken whole rather than destructured: maybeSingle() types `data` as
        // `any`, and destructuring it would launder an untyped value into state
        // with nothing to flag it.
        const result = await supabase
          .from('browse_members')
          .select('*')
          .eq('id', id)
          .abortSignal(signal)
          .maybeSingle();
        if (aborted()) return;
        if (result.error) {
          setState({
            member: null,
            loading: false,
            error: describeError(result.error, 'Could not load this member.'),
            signedOut: false,
            notFound: false,
          });
          return;
        }
        const row = result.data as BrowseMemberRow | null;
        shown.current = row ? id : null;
        setState({
          member: row ? toMember(row) : null,
          loading: false,
          error: null,
          signedOut: false,
          notFound: row === null,
        });
      } catch (e) {
        if (aborted() || again) return;
        setState({
          member: null,
          loading: false,
          error: describeThrown(e, 'Could not load this member.'),
          signedOut: false,
          notFound: false,
        });
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [id, round]);

  return state;
}

/* -------------------------------------------------------------- own profile */

/**
 * The signed-in member's own row, for the Me screen.
 *
 * Reads `members` directly rather than `browse_members`, which is the one place
 * in the app that is correct: own-row-only RLS means this returns exactly one
 * row — yours — and `birth_date` is yours to see. It never leaves the server
 * *to another member*, which is a different statement from never leaving it at
 * all, and the Me hero shows an age and a birthday derived from it.
 *
 * `phone` is still not selected here. Me's "Phone for events" card and the
 * Going sheet read it on their own (src/lib/event-phone.ts), so a column you
 * do not fetch cannot end up somewhere it should not be.
 */
export interface OwnMember {
  id: string;
  displayName: string;
  /** The @name, without the "@". */
  username: string | null;
  type: MemberType;
  photoPath: string | null;
  photoAlt: string | null;
  city: string | null;
  state: string;
  levelRange: string;
  exactLevel: string | null;
  injuryType: InjuryType | null;
  conditionName: string | null;
  /** ISO date. Own-row only — used for the age and the birthday chip. */
  birthDate: string;
  /** When they joined, for "Member since". */
  createdAt: string;
  isAdmin: boolean;
  wantsToMentor: boolean | null;
}

export interface OwnMemberState {
  member: OwnMember | null;
  /** The organization or mentor who put this member's number on the list. */
  invitedBy: string | null;
  loading: boolean;
  error: string | null;
}

const OWN_MEMBER_COLUMNS =
  'id, display_name, username, type, photo_path, photo_alt, city, state, level_range, exact_level, injury_type, condition_name, birth_date, created_at, is_admin, wants_to_mentor';

/** The row the door and Me share (lib/own-row.ts), alone if it can't be. */
async function readOwnMember(
  signal: AbortSignal,
): Promise<{ data: Record<string, unknown> | null; error: Failure | null }> {
  const shared = await readOwnRow(columnsOf(OWN_MEMBER_COLUMNS));
  if (shared?.error) return { data: null, error: shared.error };
  if (shared) return { data: shared.row, error: null };
  const { data, error } = await getSupabase()
    .from('members')
    .select(OWN_MEMBER_COLUMNS)
    .abortSignal(signal)
    .maybeSingle();
  return { data: data as Record<string, unknown> | null, error };
}

export function useOwnMember(userId: string | null): OwnMemberState {
  const [state, setState] = useState<OwnMemberState>({
    member: null,
    invitedBy: null,
    loading: true,
    error: null,
  });
  const kept = useKeptRead();

  useEffect(() => {
    if (!userId) {
      setState({ member: null, invitedBy: null, loading: false, error: null });
      return;
    }
    // Me shown again within the minute (lib/kept-reads.ts).
    if (kept.fresh(userId)) return;
    const landed = kept.start(userId);
    const controller = new AbortController();
    const { signal } = controller;
    const aborted = () => signal.aborted;

    async function load() {
      try {
        const supabase = getSupabase();
        const [own, inviter] = await Promise.all([
          readOwnMember(signal),
          // A function, not a join: the invite row itself is not readable by
          // the member it admitted, and should not be.
          supabase.rpc('my_invited_by'),
        ]);
        if (aborted()) return;

        if (own.error) {
          setState({
            member: null,
            invitedBy: null,
            loading: false,
            error: describeError(own.error, 'Could not load your profile.'),
          });
          return;
        }
        const row = own.data;
        setState({
          member: row
            ? {
                id: row.id as string,
                displayName: row.display_name as string,
                username: (row.username as string | null) ?? null,
                type: memberType(row.type),
                photoPath: (row.photo_path as string | null) ?? null,
                photoAlt: (row.photo_alt as string | null) ?? null,
                city: (row.city as string | null) ?? null,
                state: row.state as string,
                levelRange: row.level_range as string,
                exactLevel: (row.exact_level as string | null) ?? null,
                injuryType: (row.injury_type as InjuryType | null) ?? null,
                conditionName: (row.condition_name as string | null) ?? null,
                birthDate: row.birth_date as string,
                createdAt: row.created_at as string,
                isAdmin: Boolean(row.is_admin),
                wantsToMentor: (row.wants_to_mentor as boolean | null) ?? null,
              }
            : null,
          // A failed lookup is not worth an error screen — the card simply does
          // not say who invited them.
          invitedBy: inviter.error ? null : ((inviter.data as string | null) ?? null),
          loading: false,
          error: null,
        });
        landed();
      } catch (e) {
        if (aborted()) return;
        setState({
          member: null,
          invitedBy: null,
          loading: false,
          error: describeThrown(e, 'Could not load your profile.'),
        });
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [userId, kept]);

  return state;
}
