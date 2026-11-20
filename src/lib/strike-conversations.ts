import { describeError } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * The conversation about a strike or a flag (20261120120000; the owner, 2026-11-20: "there
 * should be an opportunity for them to respond"). The member it is against and every
 * administrator can read and answer it. On a flag, administrators read "The writer", never who;
 * the member reads "An administrator", never which.
 */
export type StrikeKind = 'strike' | 'flag';

export function isStrikeKind(value: string | undefined): value is StrikeKind {
  return value === 'strike' || value === 'flag';
}

export interface StrikeSummary {
  rule: string | null;
  reason: string;
  givenAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  /** The reader is the member it is against. */
  mine: boolean;
  /** A named strike's member, for an administrator. Never set on a flag. */
  memberId: string | null;
  memberName: string | null;
  /** A flag's post: its words, the topic's title and the way to it. */
  words: string | null;
  place: string | null;
  url: string | null;
}

export interface StrikeMessage {
  id: string;
  mine: boolean;
  fromMember: boolean;
  author: string;
  body: string;
  createdAt: string;
}

interface SummaryRow {
  rule: string | null;
  reason: string;
  given_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  mine: boolean;
  member_id: string | null;
  member_name: string | null;
  words: string | null;
  place: string | null;
  url: string | null;
}

interface MessageRow {
  id: string;
  mine: boolean;
  from_member: boolean;
  author: string;
  body: string;
  created_at: string;
}

type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

export async function loadStrikeConversation(
  kind: StrikeKind,
  id: string,
): Promise<Loaded<{ summary: StrikeSummary; messages: StrikeMessage[] }>> {
  const supabase = getSupabase();
  const [summary, thread] = await Promise.all([
    supabase.rpc('strike_summary', { kind, strike: id }),
    supabase.rpc('strike_thread', { kind, strike: id }),
  ]);
  if (summary.error)
    return { ok: false, error: describeError(summary.error, 'Could not load this strike.') };
  if (thread.error)
    return { ok: false, error: describeError(thread.error, 'Could not load the conversation.') };
  const row = (summary.data as SummaryRow[] | null)?.[0];
  if (!row) return { ok: false, error: 'There is no such strike.' };
  return {
    ok: true,
    value: {
      summary: {
        rule: row.rule,
        reason: row.reason,
        givenAt: row.given_at,
        withdrawnAt: row.withdrawn_at,
        withdrawnReason: row.withdrawn_reason,
        mine: row.mine,
        memberId: row.member_id,
        memberName: row.member_name,
        words: row.words,
        place: row.place,
        url: row.url,
      },
      messages: ((thread.data as MessageRow[] | null) ?? []).map((m) => ({
        id: m.id,
        mine: m.mine,
        fromMember: m.from_member,
        author: m.author,
        body: m.body,
        createdAt: m.created_at,
      })),
    },
  };
}

/** As strike_reply allows. */
export const STRIKE_MESSAGE_MAX = 2000;

export async function replyAboutStrike(
  kind: StrikeKind,
  id: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabase().rpc('strike_reply', { kind, strike: id, message });
  return error
    ? { ok: false, error: describeError(error, 'Your answer was not sent.') }
    : { ok: true };
}

/** An administrator takes a flag back: the post returns and nothing it cost counts. */
export async function withdrawFlag(
  flag: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabase().rpc('admin_withdraw_flag', {
    flag,
    withdraw_reason: reason,
  });
  return error
    ? { ok: false, error: describeError(error, 'The flag was not withdrawn.') }
    : { ok: true };
}

/**
 * As withdrawStrike in members-admin.ts, here so that the paused screen, which shows this
 * conversation, does not load the administrators' module.
 */
export async function withdrawNamedStrike(
  strike: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabase().rpc('admin_withdraw_strike', {
    strike,
    withdraw_reason: reason,
  });
  return error
    ? { ok: false, error: describeError(error, 'The strike was not withdrawn.') }
    : { ok: true };
}

export interface StrikeThreadListing {
  kind: StrikeKind;
  id: string;
  rule: string | null;
  reason: string;
  givenAt: string;
  withdrawnAt: string | null;
  /** Null on a flag. */
  memberName: string | null;
  messages: number;
  lastAt: string | null;
  /** The member spoke last: an administrator owes an answer. */
  waiting: boolean;
}

interface ListingRow {
  kind: StrikeKind;
  id: string;
  rule: string | null;
  reason: string;
  given_at: string;
  withdrawn_at: string | null;
  member_name: string | null;
  messages: number;
  last_at: string | null;
  waiting: boolean;
}

/** Every strike and flag of the last year, for administrators, latest activity first. */
export async function loadStrikeThreads(): Promise<Loaded<StrikeThreadListing[]>> {
  const result = await getSupabase().rpc('admin_strike_threads');
  if (result.error)
    return { ok: false, error: describeError(result.error, 'Could not load the strikes.') };
  const rows = result.data as ListingRow[] | null;
  return {
    ok: true,
    value: (rows ?? []).map((row) => ({
      kind: row.kind,
      id: row.id,
      rule: row.rule,
      reason: row.reason,
      givenAt: row.given_at,
      withdrawnAt: row.withdrawn_at,
      memberName: row.member_name,
      messages: row.messages,
      lastAt: row.last_at,
      waiting: row.waiting,
    })),
  };
}

export function strikePath(kind: StrikeKind, id: string): string {
  return `/strikes/${kind}/${id}`;
}
