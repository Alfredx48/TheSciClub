import { describeError, describeThrown } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/**
 * Agreeing to the terms (the owner, 2026-10-29; 20261029080000).
 *
 * The first screen after an account is made, "Before you join", says the
 * club is experience and not medical advice, and agrees to the Terms of
 * Service and the Privacy Policy by tapping Continue. The database keeps when
 * each account agreed, and to which version: the date the Terms page shows.
 *
 * Change TERMS_VERSION with the Terms, and everybody who joins after sees the
 * screen for the new one. Members already in are not asked again here.
 */

/** The Terms' date, as the database keeps it. */
export const TERMS_VERSION = '2026-11-20';

/** The same date, as the Terms page prints it. */
export const TERMS_UPDATED = 'November 20, 2026';

/** The Privacy page's own date: its newest "What changed on" note. */
export const PRIVACY_UPDATED = 'November 16, 2026';

type Failure = Parameters<typeof describeError>[0];

/**
 * Whether this account has agreed to the current version. A failure to ask
 * counts as no: the screen is shown again, which costs one tap.
 */
export async function hasAgreedToTerms(): Promise<boolean> {
  try {
    const { data, error } = (await getSupabase().rpc('my_terms_agreement')) as {
      data: string | null;
      error: Failure | null;
    };
    return !error && data !== null && data >= TERMS_VERSION;
  } catch {
    return false;
  }
}

/** Records the agreement. */
export async function agreeToTerms(): Promise<{ ok: true } | { ok: false; error: string }> {
  const refusal = 'Could not save your agreement. Try again.';
  try {
    const { error } = (await getSupabase().rpc('agree_to_terms', {
      p_version: TERMS_VERSION,
    })) as { error: Failure | null };
    return error ? { ok: false, error: describeError(error, refusal) } : { ok: true };
  } catch (thrown) {
    return { ok: false, error: describeThrown(thrown, refusal) };
  }
}
