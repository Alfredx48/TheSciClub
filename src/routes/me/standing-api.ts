import { describeError } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * A strike as the member it belongs to sees it.
 *
 * An administrator reads the same rows through `admin_strikes`, which carries
 * who issued it; a member is not shown that, because the club warned them, not
 * a person.
 *
 * ---------------------------------------------------------------------------
 * The member id is passed in, and the filter is not optional
 * ---------------------------------------------------------------------------
 * `member_strikes` carries two select policies — a member reads their own, and
 * an administrator reads every one — and Postgres ORs them. So an unfiltered
 * select returns their own rows to an ordinary member and *the whole club's* to
 * an administrator, who then reads somebody else's strike on their own Standing
 * card. That is not hypothetical: the card said "Two strikes" to an
 * administrator holding one, the first time this ran against real rows.
 *
 * The policy is right and stays. The lesson is the one already in HANDOFF.md
 * under "A view's own security check can break a caller who is not its
 * audience", in its mirror image: a policy written to be generous to one
 * audience is not a filter for another. Where a screen means "mine", it has to
 * say so.
 */
export interface MyStrike {
  id: string;
  /** A flag on one of their anonymous posts (20261120110000): a strike like any other. */
  anonymous?: boolean;
  reason: string;
  issuedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
}

interface MyStrikeRow {
  id: string;
  reason: string;
  issued_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
}

/**
 * The member's strikes that can still count: named ones and flags on their anonymous posts,
 * since their latest pause for strikes (20261120110000), newest first. afterPause says there has
 * been one, so the next three close the account rather than pause it.
 *
 * A database without the flags or pauses (before 20261120110000) reads as having none.
 */
export async function loadMyStrikes(
  memberId: string,
): Promise<{ ok: true; strikes: MyStrike[]; afterPause: boolean } | { ok: false; error: string }> {
  const supabase = getSupabase();
  const [named, flagged, paused] = await Promise.all([
    supabase
      .from('member_strikes')
      .select('id, reason, issued_at, withdrawn_at, withdrawn_reason')
      .eq('member_id', memberId)
      .order('issued_at', { ascending: false }),
    supabase.rpc('my_anonymous_strikes'),
    supabase
      .from('member_strike_pauses')
      .select('paused_at')
      .eq('member_id', memberId)
      .order('paused_at', { ascending: false })
      .limit(1),
  ]);
  if (named.error)
    return { ok: false, error: describeError(named.error, 'Could not load your standing.') };
  const pauses: { paused_at: string }[] | null = paused.data;
  const since = pauses?.[0]?.paused_at ?? null;
  const strikes: MyStrike[] = [
    ...(named.data as MyStrikeRow[]).map((row) => ({
      id: row.id,
      reason: row.reason,
      issuedAt: row.issued_at,
      withdrawnAt: row.withdrawn_at,
      withdrawnReason: row.withdrawn_reason,
    })),
    ...((flagged.data as { reason: string; flagged_at: string }[] | null) ?? []).map((row) => ({
      id: `flag:${row.flagged_at}`,
      anonymous: true,
      reason: row.reason,
      issuedAt: row.flagged_at,
      withdrawnAt: null,
      withdrawnReason: null,
    })),
  ]
    .filter((strike) => since === null || strike.issuedAt > since)
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  return { ok: true, strikes, afterPause: since !== null };
}

/** How long a strike counts for. Mirrors `strike_window()` in the database. */
export const STRIKE_MONTHS = 12;

/**
 * How many strikes pause a membership: the third pauses it for 30 days, and
 * the third after that closes it (20261120110000). Mirrors `strike_limit()`,
 * so the card can read "one more" at two without counting to three by hand.
 */
export const STRIKE_LIMIT = 3;

/**
 * Whether a strike still counts towards three.
 *
 * The same two conditions `active_strike_count()` applies, restated here
 * because the member's card has the rows in hand and asking the database to
 * count them again would be a round trip to learn something already on screen.
 * If one changes, both change — that is what the shared constant is for.
 */
export function stillCounts(strike: MyStrike, now: Date = new Date()): boolean {
  if (strike.withdrawnAt) return false;
  const expires = new Date(strike.issuedAt);
  expires.setMonth(expires.getMonth() + STRIKE_MONTHS);
  return expires > now;
}

export function countingStrikes(strikes: MyStrike[], now: Date = new Date()): MyStrike[] {
  return strikes.filter((strike) => stillCounts(strike, now));
}
