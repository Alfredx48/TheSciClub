import { describeError } from '@/lib/describe-error';
import { heldInviteToken } from '@/lib/invite-token';
import { heldQrCode } from '@/lib/qr-codes';
import { signInDestination } from '@/lib/sign-in-destination';
import { siteOrigin } from '@/lib/site-origin';
import { getSupabase } from '@/lib/supabase';

/**
 * Email and password: the account, now that a phone number is not.
 *
 * Each returns `{ ok }` or `{ ok: false, error }` with a sentence, as
 * google-sign-in.ts does.
 *
 * Joining refuses an address that is not invited before any email goes out
 * (the owner, 2026-10-11; the Before User Created hook in 20261012040000). A
 * held invite link's token travels with the sign-up, so somebody invited at
 * one address can still join with another. Whether an address already has an
 * account is still never said: Supabase answers a sign-up for a taken address
 * as though it had worked, and so does this. The confirmation link proves the
 * address is theirs, and my_invite_status checks the invite again after it.
 */

export const MIN_PASSWORD = 8;

/** Added to the confirmation link so the page can tell it came back. */
export const CONFIRMED_PARAM = 'confirmed';

export type Result =
  /** `signedIn`: there is a session already, so no email to wait for. */
  | { ok: true; signedIn?: boolean }
  | {
      ok: false;
      error: string;
      /** Signed in before the address was confirmed: the page offers the link again. */
      unconfirmed?: boolean;
      /** Sign-up refused because the address is not invited: the page shows the closed door. */
      notInvited?: boolean;
    };

export const ALREADY_JOINED_MESSAGE =
  'This email already has an account. Sign in instead, with Google or Apple if you used one before. No password yet? Use Forgot password to set one.';

/** What signup_needs_an_invite answers, word for word (20261012040000). */
export const NOT_INVITED_MESSAGE = 'This email is not on the invite list.';

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function cleanEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Straight in, confirming later, with an invite link, a live code, an invited
 * address or while joining is open (the owner, 2026-11-01 and 2026-11-10;
 * supabase/functions/invite-signup/handler.ts). False for anything else, the
 * server not answering included, and the ordinary sign-up goes on.
 */
async function signUpStraightIn(
  email: string,
  password: string,
  token: string | null,
  code: string | null,
): Promise<boolean> {
  try {
    const { data, error } = (await getSupabase().functions.invoke('invite-signup', {
      body: { email: cleanEmail(email), password, token, code },
    })) as { data: { created?: boolean } | null; error: unknown };
    if (error || !data?.created) return false;
    const signedIn = await getSupabase().auth.signInWithPassword({
      email: cleanEmail(email),
      password,
    });
    return !signedIn.error;
  } catch {
    return false;
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<Result> {
  const next = signInDestination(window.location.search);
  const query = new URLSearchParams({ [CONFIRMED_PARAM]: '1', next });
  const token = heldInviteToken();
  const code = heldQrCode();
  if (await signUpStraightIn(email, password, token, code)) {
    return { ok: true, signedIn: true };
  }
  const { data, error } = await getSupabase().auth.signUp({
    email: cleanEmail(email),
    password,
    options: {
      emailRedirectTo: `${siteOrigin()}/join?${query}`,
      ...(token || code
        ? {
            data: { ...(token ? { invite_token: token } : {}), ...(code ? { qr_code: code } : {}) },
          }
        : {}),
    },
  });
  // An address with an account already, made with Google or Apple or a
  // password: Supabase answers as though it signed up, with no identities,
  // and sends nothing (the owner waited for an email that never came,
  // 2026-10-28). Said here instead.
  if (!error && data.user?.identities?.length === 0) {
    return { ok: false, error: ALREADY_JOINED_MESSAGE };
  }
  if (!error) return { ok: true };
  if (error.status === 403 && error.message === NOT_INVITED_MESSAGE) {
    return { ok: false, error: NOT_INVITED_MESSAGE, notInvited: true };
  }
  return { ok: false, error: describeError(error, 'Could not sign you up.') };
}

/** How many letters apart, counting a swap of two as two. */
function lettersApart(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/**
 * A slip on the way to `address`, the one an invite was sent to (the owner,
 * 2026-11-01): that address needs no code, so it is worth offering back.
 */
export function isCloseTo(typed: string, address: string): boolean {
  const clean = cleanEmail(typed);
  if (!looksLikeEmail(clean) || clean === address) return false;
  return lettersApart(clean, address) <= 2;
}

/** Where the confirmation email comes from, so people know what to look for. */
export const CONFIRMATION_FROM = 'hello@thesciclub.com';

/** The code's length: Supabase sends 6 to 10 digits, never fewer. */
export const CODE_LENGTH = 6;

/**
 * The code in the confirmation email, typed on this screen (the owner,
 * 2026-10-28): no link to open, so no trip through another browser. The same
 * proof the link is that the address is theirs, and a session follows.
 */
export async function verifySignUpCode(email: string, code: string): Promise<Result> {
  const token = code.replace(/\D/g, '');
  if (token.length !== CODE_LENGTH)
    return { ok: false, error: `Enter the ${CODE_LENGTH}-digit code from the email.` };
  const { error } = await getSupabase().auth.verifyOtp({
    email: cleanEmail(email),
    token,
    type: 'email',
  });
  if (!error) return { ok: true };
  return {
    ok: false,
    error:
      error.code === 'otp_expired'
        ? 'That code has expired or is not right. Check it, or send a new one.'
        : describeError(error, 'That code did not work.'),
  };
}

export async function signInWithEmail(email: string, password: string): Promise<Result> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: cleanEmail(email),
    password,
  });
  if (!error) return { ok: true };
  if (error.code === 'email_not_confirmed') {
    return {
      ok: false,
      unconfirmed: true,
      error: 'Confirm your email first: open the link we sent you, or ask for another.',
    };
  }
  return { ok: false, error: 'That email and password did not match.' };
}

/**
 * One quiet try from "Check your email": 'in' once the link has been opened,
 * on any device; 'waiting' until then, or while rate limited or offline;
 * 'stop' for anything else, such as a password that does not match.
 */
export async function signInOnceConfirmed(
  email: string,
  password: string,
): Promise<'in' | 'waiting' | 'stop'> {
  try {
    const { error } = await getSupabase().auth.signInWithPassword({
      email: cleanEmail(email),
      password,
    });
    if (!error) return 'in';
    if (error.code === 'email_not_confirmed') return 'waiting';
    return error.status === 429 || !error.status ? 'waiting' : 'stop';
  } catch {
    return 'waiting';
  }
}

/** Says the same whether or not the address has an account. */
export async function sendPasswordReset(email: string): Promise<Result> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(cleanEmail(email), {
    redirectTo: `${siteOrigin()}/reset-password`,
  });
  return error
    ? { ok: false, error: describeError(error, 'The email was not sent. Try again in a minute.') }
    : { ok: true };
}

export async function resendConfirmation(email: string): Promise<Result> {
  const next = signInDestination(window.location.search);
  const query = new URLSearchParams({ [CONFIRMED_PARAM]: '1', next });
  const { error } = await getSupabase().auth.resend({
    type: 'signup',
    email: cleanEmail(email),
    options: { emailRedirectTo: `${siteOrigin()}/join?${query}` },
  });
  return error
    ? { ok: false, error: describeError(error, 'The email was not sent. Try again in a minute.') }
    : { ok: true };
}
