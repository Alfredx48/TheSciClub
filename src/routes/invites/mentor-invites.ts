import { describeError, type Failure } from '@/lib/describe-error';
import { setInvitesMentor } from '@/lib/organization-mentors';
import { readPages } from '@/lib/read-pages';
import { addedButNotSent, SEND_FAILED, sendInvite } from '@/lib/send-invite';
import { getSupabase } from '@/lib/supabase';

/**
 * A mentor's own invites.
 *
 * Reading and withdrawing go straight to the `invites` table, because two
 * policies already say exactly that much and nothing more:
 *
 *   mentors can see invites they sent             (select, own rows only)
 *   an inviter withdraws their own unused invite  (update, pending to revoked only)
 *
 * So there is no select filter on `invited_by_member_id` below and no
 * ownership check before withdrawing; the database is the permission check.
 *
 * Adding one is different since email sign-in: a client can no longer insert
 * into `invites` at all. `create_my_invite` does it, with the same allowance
 * rules the insert policy used to hold, and `send-invite` emails the link.
 * supabase/tests/mentor-invites.sql runs all of it as a real mentor session.
 */

export interface MentorInvite {
  id: string;
  /** The address the link goes to; null on an invite made by phone before email sign-in. */
  email: string | null;
  /** Only on an old phone invite. */
  phone: string | null;
  status: 'pending' | 'consumed' | 'revoked';
  note: string | null;
  createdAt: string;
  sentAt: string | null;
  /** Whoever joins on it becomes a mentor of its organization (20261119200000). */
  asMentor?: boolean;
}

interface MentorInviteRow {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
  note: string | null;
  created_at: string;
  sent_at: string | null;
  /** Absent before 20261119200000. */
  as_mentor?: boolean | null;
}

/**
 * What CONTEXT.md promises a mentor, and what the insert policy enforces.
 *
 * Mirrors `mentor_invite_limit()`. The database is the cap — this number is
 * here so the screen can say how many are free without asking, and the two are
 * one migration apart on purpose: raise it there and here together, or a mentor
 * reads "3 of your 10 are free" and is refused on the next one.
 */
export const MENTOR_ALLOWANCE = 10;

export async function fetchMyInvites(): Promise<
  { ok: true; invites: MentorInvite[] } | { ok: false; error: string }
> {
  const result = await readPages<MentorInviteRow>((from, to) =>
    getSupabase()
      .from('invites')
      .select('id, email, phone, status, note, created_at, sent_at, as_mentor')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not load your invites.') };
  return {
    ok: true,
    invites: (result.data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      phone: row.phone,
      status: row.status as MentorInvite['status'],
      note: row.note,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      asMentor: row.as_mentor === true,
    })),
  };
}

/**
 * Adds an address and emails its link.
 *
 * Two steps, and the second can fail on its own: the invite is then on the
 * list and spends a slot, so that comes back as `ok` with `sendError` set and
 * the row shows Resend, rather than as a failure that would be answered by
 * adding the same address again.
 */
export async function createMyInvite(input: {
  email: string;
  note: string | null;
  unlimited?: boolean;
  /** Who it makes them a member of, for an org admin of several (20261030000000). */
  organizationId?: string | null;
  /** What to call them, optional: the email's "Hi Ana," and joining's name (20261115160000). */
  name?: string | null;
  /**
   * No organization was chosen on purpose, so none is guessed (20261115160000).
   * Without it, the database gives a member of exactly one organization that one.
   */
  noOrganization?: boolean;
  /** Quoted in the email, from the inviter, optional (20261117160000). */
  message?: string | null;
  /** Whoever joins on it becomes a mentor of its organization (20261119200000). */
  asMentor?: boolean;
}): Promise<{ ok: boolean; error?: string; sendError?: string }> {
  const name = input.name?.trim() ? input.name.trim() : null;
  const message = input.message?.trim() ? input.message.trim() : null;
  // Not destructured: the client types rpc data as `any`. The version with
  // p_name (which may be null) writes the name and takes a null organization
  // as none; the one without is the iPhone app's.
  const result = await getSupabase().rpc(
    'create_my_invite',
    message
      ? {
          // The version with a message chooses between those two the same way.
          raw_email: input.email,
          p_message: message,
          note: input.note,
          p_organization: input.organizationId ?? null,
          p_name: name,
          p_no_organization: input.noOrganization === true,
        }
      : name || input.noOrganization
        ? {
            raw_email: input.email,
            p_name: name,
            note: input.note,
            p_organization: input.organizationId ?? null,
          }
        : {
            raw_email: input.email,
            note: input.note,
            p_organization: input.organizationId ?? null,
          },
  );
  if (result.error)
    return {
      ok: false,
      error: describeFailure(result.error, 'The invite was not added.', input.unlimited),
    };
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

/** A new link to the same address; the old link stops working. */
export async function resendMyInvite(id: string): Promise<{ ok: boolean; error?: string }> {
  const sent = await sendInvite(id);
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/**
 * Withdrawing sets the row to revoked rather than deleting it, the same way
 * `admin_revoke_invite` does: who vouched for whom stays on record, and
 * `live_invite_count` ignores revoked rows, so the slot comes back.
 */
export async function withdrawMyInvite(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase()
    .from('invites')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', id);
  return error
    ? { ok: false, error: describeFailure(error, 'The invite was not withdrawn.') }
    : { ok: true };
}

/* ------------------------------------------------------------ pure helpers */

/**
 * The allowance, counted the way the database counts it.
 *
 * Mirrors `live_invite_count()`: pending and consumed both spend a slot,
 * revoked does not. Somebody who joined is still using the invite that let
 * them in — the slot comes back when they leave, not when they arrive.
 */
export function liveCount(invites: MentorInvite[]): number {
  return invites.filter((i) => i.status === 'pending' || i.status === 'consumed').length;
}

export function slotsLeft(invites: MentorInvite[]): number {
  return Math.max(0, MENTOR_ALLOWANCE - liveCount(invites));
}

/**
 * What an invite is doing, in English, for the person who sent it.
 *
 * Deliberately not the administrator's wording. `/admin` says "used by Dana"
 * because an administrator needs to know who is behind an address; a mentor cannot
 * read the roster and does not need to be told the name of somebody they
 * invited themselves.
 */
export function inviteState(invite: MentorInvite): string {
  if (invite.status === 'revoked') return 'withdrawn';
  if (invite.status === 'consumed') return 'joined the club';
  return 'waiting for them to join';
}

/** Only a pending invite. Once somebody has joined on it, removing them is an administrator's job. */
export function canWithdraw(invite: MentorInvite): boolean {
  return invite.status === 'pending';
}

/**
 * Turning the database's refusal into a sentence — describeError with this
 * screen's words for the two refusals it owns.
 *
 * The same action fails two different ways and the codes are the only honest
 * way to tell them apart, which supabase/tests/mentor-invites.sql demonstrates
 * at steps 12 and 13: with the allowance full, an already-listed number is
 * refused by the *cap* and never reaches the unique index. So "refused" cannot
 * be read as "that number is taken", and a message that guessed would be
 * wrong exactly when a mentor was already confused.
 *
 * 23505 is the address already being on the list. It may be on it
 * because of somebody else's invite, which this mentor cannot see, so the
 * sentence says what is true without implying they put it there.
 *
 * 42501 is the insert policy. At this point that means the allowance, since
 * the form supplies the mentor's own id and never a claim.
 */
export function describeFailure(
  error: Failure,
  attempt = 'The invite was not added.',
  unlimited = false,
): string {
  // create_my_invite refuses with its own sentence under the same 42501 the
  // insert policy used. Its sentence is true but says nothing about the
  // allowance, which is what a mentor is asking, so it is read as a policy
  // refusal and gets this screen's words.
  const refusal =
    error.code === '42501' && /cannot add another invite/i.test(error.message)
      ? { ...error, message: 'new row violates row-level security policy for table "invites"' }
      : error;
  return describeError(refusal, {
    attempt,
    duplicate: 'That email address is already on the club’s list.',
    refused: unlimited
      ? 'You can no longer issue this invite. Your role or organization link may have changed.'
      : `You have used all ${MENTOR_ALLOWANCE} of your invites.`,
  });
}
