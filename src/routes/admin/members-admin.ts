import { forgetPartnerTitles } from '@/lib/club-partners';
import { describeError } from '@/lib/describe-error';
import { setInvitesMentor } from '@/lib/organization-mentors';
import { addedButNotSent, SEND_FAILED, sendInvite } from '@/lib/send-invite';
import type { StrikeRule } from '@/lib/strike-rules';
import { getSupabase } from '@/lib/supabase';
import { detailsFrom } from '@/routes/profile/details-api';
import { answersFrom } from '@/routes/profile/profile-api';
import { nextStep, profilePercent, stepAction } from '@/routes/profile/progress';
import { memberType, type Organization } from '@/types/domain';

/**
 * The administrative view of the roster, and the two things an administrator
 * can do to a row.
 *
 * Everything goes through `admin_members` and the `admin_*` functions, which
 * check membership and administrator status in the database. Nothing here is
 * the permission check — this is the client asking, and the database deciding.
 */

export interface AdminMember {
  id: string;
  displayName: string;
  /** The optional contact number for events, typed by the member. Not what signs them in. */
  phone: string | null;
  /** The account's address, from Auth. Null for an account that has none yet (a phone member). */
  email: string | null;
  username: string | null;
  type: 'peer' | 'mentor' | 'organization';
  status: 'active' | 'suspended' | 'removed';
  isAdmin: boolean;
  isSeed: boolean;
  city: string | null;
  state: string;
  createdAt: string;
  /**
   * Invites this member has spent, counted by live_invite_count() — the same
   * function the insert policy caps on, so the roster cannot disagree with it.
   * `undefined` where the view does not report it yet.
   */
  invitesUsed: number | undefined;
  unlimitedInvites?: boolean;
  /**
   * Strikes that still count: not withdrawn, and inside `strike_window()`.
   * Counted by the database rather than here, so the roster, the member's own
   * card and the function that issues them cannot disagree about who is on two.
   */
  strikes: number;
}

interface AdminMemberRow {
  id: string;
  display_name: string;
  phone: string | null;
  email?: string | null;
  username?: string | null;
  type: string;
  status: string;
  is_admin: boolean;
  is_seed: boolean;
  city: string | null;
  state: string;
  created_at: string;
  invites_used: number | null;
  unlimited_invites?: boolean;
  strikes: number | null;
}

function toAdminMember(row: AdminMemberRow): AdminMember {
  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email ?? null,
    username: row.username ?? null,
    type: memberType(row.type),
    status: row.status as AdminMember['status'],
    isAdmin: row.is_admin,
    isSeed: row.is_seed,
    city: row.city,
    state: row.state,
    createdAt: row.created_at,
    invitesUsed: row.invites_used ?? undefined,
    unlimitedInvites: row.unlimited_invites ?? false,
    // A database that predates 20260916040000 reports nothing here, and no
    // strikes is the honest reading of that rather than a blank.
    strikes: row.strikes ?? 0,
  };
}

/** Which part of the roster: as Admin's filters, and 'active' for a picker. */
export type RosterFilter = 'all' | 'joined' | 'directory' | 'attention' | 'active';

/** Rows read at a time; Show more reads as many again. */
export const ROSTER_PAGE = 50;

/**
 * The roster, searched and paged by the database (20261029230000): the API
 * returns at most 1,000 rows, so reading it whole could never find member
 * 1,001. Newest first. `memberId` reads just that member.
 */
export async function fetchMemberPage({
  query = '',
  filter = 'all',
  memberId = null,
  offset = 0,
  limit = ROSTER_PAGE,
}: {
  query?: string;
  filter?: RosterFilter;
  memberId?: string | null;
  offset?: number;
  limit?: number;
}): Promise<{ ok: true; members: AdminMember[]; total: number } | { ok: false; error: string }> {
  const result = await getSupabase().rpc('admin_member_search', {
    // A username is stored without its @, and no address starts with one.
    p_query: query.trim().replace(/^@/, '') || null,
    p_filter: filter,
    p_member: memberId,
    p_limit: limit,
    p_offset: offset,
  });
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not load the members.') };
  const rows = (result.data ?? []) as (AdminMemberRow & { total: number })[];
  return { ok: true, members: rows.map(toAdminMember), total: rows[0]?.total ?? 0 };
}

export interface RosterCounts {
  everyone: number;
  joined: number;
  directory: number;
  /** Joined, and paused or with a strike that counts. */
  attention: number;
}

export async function fetchMemberCounts(): Promise<
  { ok: true; counts: RosterCounts } | { ok: false; error: string }
> {
  const result = await getSupabase().rpc('admin_member_counts');
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not count the members.') };
  const row = (
    result.data as
      | { everyone: number; joined: number; directory: number; attention: number }[]
      | null
  )?.[0];
  return {
    ok: true,
    counts: {
      everyone: row?.everyone ?? 0,
      joined: row?.joined ?? 0,
      directory: row?.directory ?? 0,
      attention: row?.attention ?? 0,
    },
  };
}

/** Whether the club can reach a member (20261022040000). */
export interface MemberReach {
  /** Devices with notifications on. */
  pushDevices: number;
  /** When a session last began in the Home Screen app; null if never seen. */
  homeScreenAt: string | null;
  /**
   * The iPhone app (the owner, 2026-11-16: "if the user has iOS installed"),
   * as the club knows it (20261116210000): when last seen open, null when only
   * its notification token says so. Null when not known to have it; undefined
   * when that could not be read, and then nothing is said about it.
   */
  iPhoneApp?: { lastSeen: string | null } | null;
}

/** By member id. Null when it cannot be read, and then nothing is shown. */
export async function fetchMemberReach(): Promise<Map<string, MemberReach> | null> {
  const supabase = getSupabase();
  const [reach, app] = (await Promise.all([
    supabase.rpc('admin_member_reach'),
    supabase.rpc('admin_members_with_the_app'),
  ])) as [
    {
      data: { member_id: string; push_devices: number; home_screen_at: string | null }[] | null;
      error: unknown;
    },
    { data: { member_id: string; last_seen: string | null }[] | null; error: unknown },
  ];
  if (reach.error || !reach.data) return null;
  const apps =
    app.error || !app.data ? null : new Map(app.data.map((row) => [row.member_id, row.last_seen]));
  return new Map(
    reach.data.map((row) => [
      row.member_id,
      {
        pushDevices: row.push_devices,
        homeScreenAt: row.home_screen_at,
        ...(apps
          ? {
              iPhoneApp: apps.has(row.member_id)
                ? { lastSeen: apps.get(row.member_id) ?? null }
                : null,
            }
          : {}),
      },
    ]),
  );
}

/** The database's own refusal is passed through verbatim — it says why. */
export async function setMemberStatus(
  target: string,
  status: AdminMember['status'],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_set_member_status', {
    target,
    new_status: status,
  });
  return error
    ? { ok: false, error: describeError(error, 'Their standing was not changed.') }
    : { ok: true };
}

/**
 * Clear a member's photo folder.
 *
 * `admin_delete_member` is a SQL function and cannot reach the storage API, so
 * this is the half of a removal that has to happen in the client. Permitted by
 * the policy added in 20260918000000; before it, an administrator could end a
 * membership and not remove the picture, which stayed retrievable at a URL
 * derived from the member's id because the bucket is public.
 *
 * Runs after the removal and never before, and its failure is not the caller's
 * failure: the membership is the thing being ended, and a picture that will not
 * delete must not make a successful removal report an error. It returns nothing
 * for that reason.
 */
async function clearPhotoFolder(memberId: string): Promise<void> {
  const supabase = getSupabase();
  const listed = await supabase.storage.from('photos').list(memberId);
  if (listed.error) return;
  const paths = listed.data.map((o) => `${memberId}/${o.name}`);
  if (paths.length > 0) await supabase.storage.from('photos').remove(paths);
}

// Not the photographs they put in chat. Those stay with their words — see
// 20260918200000 — and an administrator could not delete them anyway: the
// storage API deletes only what the caller can select, and a picture in a
// conversation an administrator is not in is not selectable by them, on
// purpose.
export async function deleteMember(target: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_delete_member', { target });
  if (error) return { ok: false, error: describeError(error, 'They were not removed.') };
  await clearPhotoFolder(target);
  return { ok: true };
}

/* ----------------------------------------------------------------- invites */

export interface AdminInvite {
  id: string;
  /** The address the link goes to. Null on an old phone invite. */
  email: string | null;
  /** Only on an invite made before email sign-in; null on every email invite. */
  phone: string | null;
  /** When the link last went out; null until it has. */
  sentAt: string | null;
  claimedAt: string | null;
  status: 'pending' | 'consumed' | 'revoked';
  note: string | null;
  createdAt: string;
  invitedByOrganization: string | null;
  invitedByMember: string | null;
  /** Whether that member is the club's administrator rather than a mentor. */
  invitedByMemberIsAdmin: boolean | undefined;
  /**
   * The member on this number.
   *
   * Three values, and they are three different things. A name is a member who
   * is here. `null` is "nobody is on this number". `undefined` is "this copy of
   * the view does not report it" — `held_by` arrived in a later migration, and
   * a deployment where the app is ahead of the database gets that.
   *
   * Keeping the third apart from the second matters: conflating them printed
   * "that account has since been deleted" against every used invite on a
   * database that simply had not been migrated yet, including the club's own
   * administrator.
   */
  heldBy: string | null | undefined;
  heldByStatus: 'active' | 'suspended' | 'removed' | null | undefined;
  /**
   * Whether an account exists for this invite: one that claimed its link, or a
   * confirmed one at the invited address (an old phone invite: a verified number).
   *
   * Not the same question as `heldBy`, and the gap between them is the point:
   * an invite that is still pending while an account exists is somebody who
   * started and stopped. The invite is consumed by a trigger on the *member*
   * insert, so abandoning onboarding leaves no trace anywhere else.
   *
   * `undefined` is again "this copy of the view does not report it", for the
   * same reason it is on `heldBy`.
   */
  hasAccount: boolean | undefined;
  /**
   * Written by the club for somebody who joined while anybody could join
   * (20261014010000): nobody vouched, and the list says so instead.
   */
  joinedWhileOpen: boolean;
  /** Joined from an administrator's QR code (20261014020000); the inviter is that administrator. */
  fromQrCode: boolean;
  /** The event that code was made for; null for "No event". */
  qrEventName: string | null;
}

interface AdminInviteRow {
  id: string;
  email?: string | null;
  phone: string | null;
  sent_at?: string | null;
  claimed_at?: string | null;
  status: string;
  note: string | null;
  created_at: string;
  invited_by_organization: string | null;
  invited_by_member: string | null;
  invited_by_member_is_admin: boolean | null;
  held_by: string | null;
  held_by_status: string | null;
  has_account: boolean | null;
  /** Absent before 20261014010000. */
  joined_while_open?: boolean | null;
  /** Absent before 20261014020000. */
  from_qr_code?: boolean | null;
  qr_event_name?: string | null;
}

export interface InvitingOrganization {
  id: string;
  name: string;
  shortCode: string;
}

function toAdminInvite(row: AdminInviteRow): AdminInvite {
  return {
    id: row.id,
    email: row.email ?? null,
    phone: row.phone,
    sentAt: row.sent_at ?? null,
    claimedAt: row.claimed_at ?? null,
    status: row.status as AdminInvite['status'],
    note: row.note,
    createdAt: row.created_at,
    invitedByOrganization: row.invited_by_organization,
    invitedByMember: row.invited_by_member,
    invitedByMemberIsAdmin: row.invited_by_member_is_admin ?? undefined,
    heldBy: row.held_by,
    heldByStatus: row.held_by_status as AdminInvite['heldByStatus'],
    hasAccount: row.has_account ?? undefined,
    joinedWhileOpen: row.joined_while_open === true,
    fromQrCode: row.from_qr_code === true,
    qrEventName: row.qr_event_name ?? null,
  };
}

/** Invites read at a time; Show more reads as many again. */
export const INVITE_PAGE = 50;

/**
 * "The list" (every invite not withdrawn) or Withdrawn, newest first, paged
 * by the database (20261104201000). Reading the whole view could never show
 * more than the API's 1,000 rows.
 */
export async function fetchInvitePage({
  part,
  offset = 0,
  limit = INVITE_PAGE,
}: {
  part: 'listed' | 'withdrawn';
  offset?: number;
  limit?: number;
}): Promise<{ ok: true; rows: WithdrawnInvite[]; total: number } | { ok: false; error: string }> {
  const result = await getSupabase().rpc('admin_invite_page', {
    p_part: part,
    p_limit: limit,
    p_offset: offset,
  });
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not load the invites.') };
  const rows = (result.data ?? []) as (AdminInviteRow & { times: number; total: number })[];
  return {
    ok: true,
    rows: rows.map((row) => ({ invite: toAdminInvite(row), times: row.times })),
    total: rows[0]?.total ?? 0,
  };
}

/** Invites waiting, for the header. */
export async function fetchPendingInvites(): Promise<
  { ok: true; pending: number } | { ok: false; error: string }
> {
  const result = await getSupabase().rpc('admin_invite_counts');
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not count the invites.') };
  const row = (result.data as { pending: number }[] | null)?.[0];
  return { ok: true, pending: row?.pending ?? 0 };
}

/**
 * Who an administrator may invite under: every organization in the directory
 * (the owner, 2026-11-25), but not the club itself, which is "no organization".
 */
export function invitableOrganizations(organizations: readonly Organization[]): Organization[] {
  return organizations
    .filter((organization) => !/^the sci club$/i.test(organization.name.trim()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Organizations allowed to vouch. Public data, but only listed to admins here. */
export async function fetchInvitingOrganizations(): Promise<InvitingOrganization[]> {
  const result = await getSupabase()
    .from('organizations')
    .select('id, name, short_code')
    .eq('can_invite', true)
    .is('removed_at', null)
    .order('name');
  if (result.error) return [];
  return (result.data as { id: string; name: string; short_code: string }[]).map((o) => ({
    id: o.id,
    name: o.name,
    shortCode: o.short_code,
  }));
}

/**
 * admin_create_invite refuses in its own sentences — a blocked number, an
 * organization that cannot invite — and those pass through. The unique index
 * is behind it for a number already on the list.
 */
const INVITE_REFUSAL = {
  attempt: 'The invite was not added.',
  duplicate: 'That email address is already on the club’s list.',
};

/**
 * Adds an address to the list, then emails its link.
 *
 * The two are separate on purpose. An invite that is on the list but whose
 * email failed is still a real invite, so that case comes back `ok` with
 * `sendError` set and the row visible, ready for Resend; reporting it as a
 * failure would invite a second Add, which the unique index then refuses.
 */
export async function createInvite(input: {
  email: string;
  /** Null when the administrator is vouching in their own name. */
  organizationId: string | null;
  note: string | null;
  /** What to call them, optional: the email's "Hi Ana," and joining's name (20261115160000). */
  name?: string | null;
  /** Quoted in the email, from the inviter, optional (20261117160000). */
  message?: string | null;
  /** Whoever joins on it becomes a mentor of its organization (20261119200000). */
  asMentor?: boolean;
}): Promise<{ ok: boolean; error?: string; sendError?: string }> {
  const name = input.name?.trim() ? input.name.trim() : null;
  const message = input.message?.trim() ? input.message.trim() : null;
  // Not destructured: the client types rpc data as `any`. With a name or a
  // message only: the version without either is the iPhone app's too.
  const result = await getSupabase().rpc(
    'admin_create_invite',
    message
      ? {
          raw_email: input.email,
          p_message: message,
          organization_id: input.organizationId,
          note: input.note,
          p_name: name,
        }
      : {
          raw_email: input.email,
          organization_id: input.organizationId,
          note: input.note,
          ...(name ? { p_name: name } : {}),
        },
  );
  if (result.error) return { ok: false, error: describeError(result.error, INVITE_REFUSAL) };
  const created: unknown = result.data;
  const id = (created as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') return { ok: true, sendError: SEND_FAILED };
  // A mentor's invite is marked before its email goes (20261119200000). If
  // that fails, no email: the invite would make a member, not a mentor.
  if (input.asMentor) {
    const marked = await setInvitesMentor([id], true);
    if (!marked.ok)
      return {
        ok: true,
        sendError: `It is on the list, but not as a mentor (${marked.error}), so the email has not gone. Withdraw it and add them again.`,
      };
  }
  const sent = await sendInvite(id);
  return sent.ok ? { ok: true } : { ok: true, sendError: addedButNotSent(sent.error) };
}

export type ListOutcome = 'added' | 'repeat' | 'not_an_email' | 'blocked' | 'on_list' | 'member';

export interface ListEntry {
  email: string;
  name: string | null;
  outcome: ListOutcome;
  inviteId: string | null;
}

/**
 * Puts a list on the club's list in one go (admin_invite_list,
 * 20261114010000), each invite from this administrator, for the organization
 * chosen, with their message, and a phone number to fill in when they join
 * (20261119210000). Says what became of each address; the emails go
 * afterwards, one at a time, through sendInvite.
 */
export async function inviteList(input: {
  people: { email: string; name: string | null; phone?: string | null }[];
  organizationId: string | null;
  message: string | null;
}): Promise<{ ok: true; entries: ListEntry[] } | { ok: false; error: string }> {
  const result = await getSupabase().rpc('admin_invite_list', {
    p_people: input.people.map(({ email, name, phone }) => ({ email, name, phone: phone ?? null })),
    p_organization: input.organizationId,
    p_message: input.message,
  });
  if (result.error) {
    return { ok: false, error: describeError(result.error, 'The list was not added.') };
  }
  const rows: unknown = result.data;
  if (!Array.isArray(rows)) return { ok: false, error: 'The list was not added.' };
  return {
    ok: true,
    entries: (rows as Record<string, unknown>[]).map((r) => ({
      email: typeof r.email === 'string' ? r.email : '',
      name: typeof r.name === 'string' ? r.name : null,
      outcome: (typeof r.outcome === 'string' ? r.outcome : 'not_an_email') as ListOutcome,
      inviteId: typeof r.invite_id === 'string' ? r.invite_id : null,
    })),
  };
}

/** Another link to the same address; the old link stops working. */
export async function resendInvite(id: string): Promise<{ ok: boolean; error?: string }> {
  const sent = await sendInvite(id);
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

export async function revokeInvite(target: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_revoke_invite', { target });
  return error
    ? { ok: false, error: describeError(error, 'The invite was not withdrawn.') }
    : { ok: true };
}

export async function setMemberType(
  target: string,
  type: 'peer' | 'mentor' | 'organization',
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_set_member_type', {
    target,
    new_type: type,
  });
  return error
    ? { ok: false, error: describeError(error, 'Their role was not changed.') }
    : { ok: true };
}

/**
 * Change the profession beside a staff member's name (20261104160000). Making
 * someone staff is setStaff, which asks for their organization.
 */
export async function setPartner(
  target: string,
  title: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_set_partner', {
    p_member: target,
    p_title: title,
  });
  forgetPartnerTitles();
  return error
    ? { ok: false, error: describeError(error, 'Their profession was not changed.') }
    : { ok: true };
}

/**
 * Make them staff of an organization, or change which (20261117000000; the
 * owner, 2026-11-16: "if we are marking somebody as either staff or mentor in
 * the admin panel, we should have selection for which organization").
 */
export async function setStaff(
  target: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_set_staff', {
    p_member: target,
    p_organization: organizationId,
  });
  forgetPartnerTitles();
  return error
    ? { ok: false, error: describeError(error, 'They were not made staff.') }
    : { ok: true };
}

/** Make them a mentor of an organization (grant_mentor, 20261028950000). */
export async function makeMentorOf(
  target: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('grant_mentor', {
    organization: organizationId,
    member: target,
  });
  return error
    ? { ok: false, error: describeError(error, 'They were not made a mentor.') }
    : { ok: true };
}

export async function removePartner(target: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_remove_partner', { p_member: target });
  forgetPartnerTitles();
  return error ? { ok: false, error: describeError(error, 'They are still staff.') } : { ok: true };
}

/**
 * What an invite's state is, in English.
 *
 * The status alone was printed raw, so a consumed invite whose member has
 * since been deleted read "consumed" — which asserts that somebody used this
 * and is in the club, when nobody is. The list is read by whoever decides who
 * belongs; it should not assert that.
 *
 * Nor should it assert the opposite. `heldBy` being absent means this database
 * does not report holders yet, which is not the same as there being none, and
 * saying nothing is the honest answer there.
 */
export function inviteState(invite: AdminInvite): string {
  if (invite.status === 'revoked') return 'revoked';

  // Pending with an account behind it is the case nobody could see: they
  // got an account (opened the link, or confirmed the address), landed in
  // onboarding and stopped. Worth saying,
  // because it is the one state on this list somebody would act on — the
  // person tried and something got in the way.
  if (invite.status === 'pending') {
    return invite.hasAccount === true ? 'signed up, never finished joining' : 'not used yet';
  }

  // The view does not carry a holder. Say what the status says and no more.
  if (invite.heldBy === undefined) return 'used';

  // Used once, and nobody is on the number now — which is the same thing an
  // administrator needs to know about it as a number that was never used at
  // all: nobody is behind it, and you can take it off the list. It reads the
  // same because it is the same, and a separate word for it only invited the
  // question of what the difference was. The row keeps its 'consumed' status
  // in the database, so the history is not lost, only the distinction that
  // nobody could act on.
  if (invite.heldBy === null) return 'not used yet';

  // A walk-in had no invite to use (vouchedBy says how they came): just who.
  const who = invite.joinedWhileOpen ? invite.heldBy : `used by ${invite.heldBy}`;
  if (invite.heldByStatus === 'removed') return `${who}, who was removed`;
  if (invite.heldByStatus === 'suspended') return `${who}, suspended`;
  return who;
}

/** Dates the way the list reads them: "3 Oct". */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

/**
 * Where an email invite's link has got to: sent, or not sent yet. Said on its
 * own line from the state because "not used yet" does not tell an
 * administrator whether the person has been emailed at all.
 */
export function deliveryNote(invite: AdminInvite): string | null {
  if (invite.status === 'revoked' || invite.email === null) return null;
  // No link was ever owed to a walk-in.
  if (invite.joinedWhileOpen) return null;
  if (invite.sentAt === null) return 'link not sent yet';
  const sent = `link sent ${shortDate(invite.sentAt)}`;
  return invite.claimedAt && invite.status === 'pending'
    ? `${sent}, opened ${shortDate(invite.claimedAt)}`
    : sent;
}

/* ---------------------------------------------------------- blocked emails */

export interface BlockedEmail {
  email: string;
  reason: string | null;
  blockedAt: string;
  blockedBy: string | null;
}

interface BlockedEmailRow {
  email: string;
  note: string | null;
  blocked_at: string;
  blocked_by: string | null;
}

/**
 * The blocklist.
 *
 * Empty rather than failing when the view is absent: the app is deployed
 * ahead of the database often enough in this project that a missing view
 * should cost a section of a screen, not the screen.
 */
export async function fetchBlockedEmails(): Promise<BlockedEmail[]> {
  const result = await getSupabase()
    .from('admin_blocked_emails')
    .select('*')
    .order('blocked_at', { ascending: false });
  if (result.error) return [];
  return (result.data as BlockedEmailRow[]).map((row) => ({
    email: row.email,
    reason: row.note,
    blockedAt: row.blocked_at,
    blockedBy: row.blocked_by,
  }));
}

/**
 * Bar an address from the list until somebody unblocks it. Live invites for it
 * are withdrawn inside `admin_block_email`; a member already on that address is
 * not touched (see `removeAndBlock`).
 */
export async function blockEmail(
  email: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_block_email', {
    raw_email: email,
    note: reason,
  });
  return error
    ? { ok: false, error: describeError(error, 'The address was not blocked.') }
    : { ok: true };
}

export async function unblockEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_unblock_email', { raw_email: email });
  return error
    ? { ok: false, error: describeError(error, 'The address was not unblocked.') }
    : { ok: true };
}

/**
 * Remove a member and bar the way back in.
 *
 * `admin_block_email` does not remove a member, so this is two calls, **block
 * first**: if the second fails the address is barred and the member is still
 * there, which an administrator can see and finish; the other order could
 * leave somebody removed and free to be invited again, and look like it
 * worked. A member with no email (a phone account that never added one) is
 * blocked by number, which does both in one function.
 */
export async function removeAndBlock(
  member: { id: string; email: string | null; phone: string | null },
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (member.email) {
    const blocked = await blockEmail(member.email, reason);
    if (!blocked.ok) return blocked;
    const removed = await deleteMember(member.id);
    return removed.ok
      ? removed
      : {
          ok: false,
          error: `${member.email} is blocked, but the member was not removed: ${removed.error ?? 'try again'}`,
        };
  }
  if (!member.phone) {
    return {
      ok: false,
      error: 'They have no email address or number on file to block. Remove them without blocking.',
    };
  }
  const { error } = await getSupabase().rpc('admin_block_number', {
    raw_phone: member.phone,
    block_reason: reason,
  });
  if (error) return { ok: false, error: describeError(error, 'They were not removed.') };
  // admin_block_number removes the member found by the number Auth verified. A
  // row with no such account (a seeded profile, or a member whose typed number
  // differs) is still there, so finish the removal; "No such member" means the
  // first call already did it.
  const removed = await deleteMember(member.id);
  if (!removed.ok && removed.error !== 'No such member') return removed;
  await clearPhotoFolder(member.id);
  return { ok: true };
}

/**
 * The withdrawn list: one row per person, and only people actually off the
 * list.
 *
 * Revoking does not delete, deliberately — the row keeps who vouched and
 * when. Re-inviting writes a *new* row rather than reviving the old one, so
 * withdrawing that one too leaves two revoked rows, then three. Sound in the
 * database and unreadable on a screen, so admin_invite_page('withdrawn')
 * groups them (20261104201000):
 *
 * - An address with a live invite is not withdrawn, whatever its history says.
 * - A blocked address belongs in Blocked, not in both.
 * - Everything else collapses to its most recent invitation, with a count.
 *
 * The key is the email, or the phone for an old phone invite. Most recent
 * first, by when the invitation was created.
 */
export interface WithdrawnInvite {
  /** The most recent withdrawn invitation for this address; on The list, the invite. */
  invite: AdminInvite;
  /** How many times this address has been invited and withdrawn. */
  times: number;
}

/** An invite made when the phone was the account. It cannot be used now; it can be re-issued by email. */
export function isOldPhoneInvite(invite: AdminInvite): boolean {
  return invite.email === null && invite.phone !== null;
}

/** What to call whoever an invite is for. */
export function inviteLabel(invite: AdminInvite): string {
  return invite.email ?? invite.phone ?? 'Unknown';
}

/**
 * Re-issue an old phone invite by email: a new invite at the address, then the
 * phone one withdrawn so the person is not on the list twice. The new invite
 * keeps the old one's organization (matched by name) and note.
 */
export async function reinviteByEmail(
  old: AdminInvite,
  email: string,
  organizations: InvitingOrganization[],
): Promise<{ ok: boolean; error?: string; sendError?: string }> {
  const org = old.invitedByOrganization
    ? organizations.find((o) => o.name === old.invitedByOrganization)
    : undefined;
  const created = await createInvite({
    email,
    organizationId: org?.id ?? null,
    note: old.note,
  });
  if (!created.ok) return created;
  if (old.status === 'pending') await revokeInvite(old.id);
  return created;
}

/**
 * Who put this number on the list, and what kind of thing they are.
 *
 * The view has carried the organization and the member separately since it
 * was written, and the page collapsed them into one name — so "NorCal SCI"
 * and "Todd" read identically. Which of the two vouched is exactly what
 * matters when a number turns out to belong to somebody who should not be
 * here: an organization's invite is a process, a mentor's is a person who can
 * be asked about it.
 */
export function vouchedBy(invite: AdminInvite): string {
  // An administrator's QR code: who held it up, and where.
  if (invite.fromQrCode) {
    const who = `Invited by ${invite.invitedByMember ?? 'an administrator no longer here'}`;
    return invite.qrEventName ? `${who} · ${invite.qrEventName}` : who;
  }
  // Nobody vouched, and "unknown" would read as a lost record.
  if (invite.joinedWhileOpen) return 'Joined when invite only was off';
  if (invite.invitedByOrganization) return invite.invitedByOrganization;
  // A member inviter used to mean a mentor and nothing else. An
  // administrator can now add a number in their own name, and calling them a
  // mentor on every one of those would be wrong on the record that exists to
  // say who vouched.
  if (invite.invitedByMember) {
    return `${invite.invitedByMember} (${invite.invitedByMemberIsAdmin ? 'admin' : 'mentor'})`;
  }
  // The inviter's account is gone — `on delete set null` keeps the invite and
  // drops who issued it, which is honest and is not a bug to paper over.
  return 'unknown';
}

/**
 * Whether an administrator can take this number off the list.
 *
 * A pending invite, always. A used one only when nobody is on the number —
 * revoking a live member's invite would take their membership away through the
 * wrong door, and admin_set_member_status is that door. With the member gone
 * there is no door to use instead, and the row is otherwise unreachable while
 * still blocking the number from being invited again.
 *
 * `undefined` is not `null`: a view that does not report holders cannot tell
 * us nobody is there, so the button stays hidden rather than offering an
 * action the database will refuse.
 */
export function canRevoke(invite: AdminInvite): boolean {
  if (invite.status === 'pending') return true;
  return invite.status === 'consumed' && invite.heldBy === null;
}

/* ----------------------------------------------------------------- strikes */

export interface Strike {
  id: string;
  memberId: string;
  /** Which rule (strike-rules.ts), or null for one from before rules. */
  rule: string | null;
  reason: string;
  issuedAt: string;
  issuedByName: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  /** Whether it still counts towards three. A withdrawn or year-old one does not. */
  counts: boolean;
}

interface StrikeRow {
  id: string;
  member_id: string;
  rule?: string | null;
  reason: string;
  issued_at: string;
  issued_by_name: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  counts: boolean;
}

function toStrike(row: StrikeRow): Strike {
  return {
    id: row.id,
    memberId: row.member_id,
    rule: row.rule ?? null,
    reason: row.reason,
    issuedAt: row.issued_at,
    issuedByName: row.issued_by_name,
    withdrawnAt: row.withdrawn_at,
    withdrawnReason: row.withdrawn_reason,
    counts: row.counts,
  };
}

/** Every strike the club has issued, newest first. Administrators only. */
export async function fetchStrikes(): Promise<
  { ok: true; strikes: Strike[] } | { ok: false; error: string }
> {
  const result = await getSupabase()
    .from('admin_strikes')
    .select('*')
    .order('issued_at', { ascending: false });
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not load the strikes.') };
  return { ok: true, strikes: (result.data as StrikeRow[]).map(toStrike) };
}

/**
 * Give somebody a strike, and report how many named strikes now count and
 * what it did (admin_strike_member, 20261120110000): nothing more, a pause of
 * 30 days on the third, or, on the third after a pause, the account closed
 * and its address blocked. A closed account's photographs go as Remove's do.
 */
export async function addStrike(
  target: string,
  reason: string,
  rule: StrikeRule,
): Promise<{
  ok: boolean;
  error?: string;
  strikes?: number;
  outcome?: 'none' | 'paused' | 'closed';
  pausedUntil?: string | null;
}> {
  const result = await getSupabase().rpc('admin_strike_member', {
    target,
    strike_reason: reason,
    strike_rule: rule,
  });
  if (result.error)
    return { ok: false, error: describeError(result.error, 'The strike was not added.') };
  const rows = result.data as
    | { strikes: number; outcome: 'none' | 'paused' | 'closed'; paused_until: string | null }[]
    | null;
  const row = rows?.[0];
  if (!row) return { ok: true };
  if (row.outcome === 'closed') await clearPhotoFolder(target);
  return { ok: true, strikes: row.strikes, outcome: row.outcome, pausedUntil: row.paused_until };
}

export async function withdrawStrike(
  strike: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc('admin_withdraw_strike', {
    strike,
    withdraw_reason: reason,
  });
  return error
    ? { ok: false, error: describeError(error, 'The strike was not withdrawn.') }
    : { ok: true };
}

/* ------------------------------------------------------------------ tally */

export interface TallyRow {
  /** The event's name as typed; null is "No event", and walk-ins have their own row. */
  label: string;
  joined: number;
  /** Per administrator, most first. Empty for walk-ins. */
  byAdmin: { name: string; joined: number }[];
}

/**
 * Who joined while anybody could join, counted the owner's way (2026-10-14):
 * by event, then by the administrator whose code it was, and the walk-ins who
 * came with no code on a line of their own. Events are grouped by the name
 * exactly as typed. Only invites still in use count: a member removed or gone
 * is not somebody the event brought in now. Counted by admin_join_tally
 * (20261104201000) over every such invite.
 */
export async function fetchJoinTally(): Promise<
  { ok: true; rows: TallyRow[] } | { ok: false; error: string }
> {
  const result = await getSupabase().rpc('admin_join_tally');
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not count who joined.') };
  const rows = (result.data ?? []) as {
    walk_ins: boolean;
    event_name: string | null;
    joined: number;
    by_admin: { name: string | null; joined: number }[];
  }[];
  return {
    ok: true,
    rows: rows.map((row) => ({
      label: row.walk_ins ? 'Walk-ins, no code' : (row.event_name ?? 'No event'),
      joined: row.joined,
      byAdmin: row.by_admin.map((a) => ({
        name: a.name ?? 'An administrator no longer here',
        joined: a.joined,
      })),
    })),
  };
}

/** How far a member's profile is: what their own Me card says. */
export interface ProfileProgress {
  percent: number;
  /** "Add a profile photo"; null once nothing is left. */
  next: string | null;
}

/**
 * Every joined member's profile percentage and next step (20261115090000), as
 * the app works them out for the member themselves.
 */
export async function fetchProfileProgress(): Promise<
  { ok: true; byMember: Map<string, ProfileProgress> } | { ok: false; error: string }
> {
  const result = await getSupabase().rpc('admin_member_profiles');
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not read the profiles.') };
  const rows = (result.data ?? []) as { id: string; profile: Record<string, unknown> | null }[];
  const byMember = new Map<string, ProfileProgress>();
  for (const row of rows) {
    const profile = row.profile ?? {};
    const details = detailsFrom(profile);
    const { answers, declined } = answersFrom(profile);
    const step = nextStep(details, answers, declined);
    byMember.set(row.id, {
      percent: profilePercent(details, answers, declined),
      next: step ? stepAction(step) : null,
    });
  }
  return { ok: true, byMember };
}
