import { useCallback, useEffect, useState } from 'react';
import { describeError } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';
import type { StatsPeriod } from '@/routes/admin/club-stats';

/**
 * How each member signs up and signs in, for Admin → Stats (20261016000000).
 *
 * Unlike the rest of Stats this names people (the owner, 2026-10-16). The
 * way an account was made is its first identity, which Supabase keeps; each
 * sign-in is a row the app reports once a session (src/lib/sign-in-record.ts),
 * which the database reads from the session's own token.
 */

/**
 * email, google and apple are the ways in; link is a password reset or an
 * emailed link; oauth is Google or Apple when the database could not tell
 * which (see the migration). Never phone: it signs nobody in now, and the
 * owner had it left off (20261016010000).
 */
export type SignInMethod = string;

export interface MethodCount {
  signIns: number;
  people: number;
}

/** The invite that let somebody in (20261102010000). */
export interface CameBy {
  way: 'qr' | 'open' | 'organization' | 'member';
  /** The organization or member; gone from the club, null. */
  by: string | null;
  /** A QR code's event. */
  event: string | null;
  /** Who made the QR code or invite link, when and how (20261125120000); absent before it. */
  madeBy?: string | null;
  madeAt?: string | null;
  madeAs?: 'qr' | 'link' | 'qr_and_link' | 'share' | null;
}

export interface SignInAccount {
  id: string;
  name: string | null;
  username: string | null;
  /** Only for an account that is not a member yet, which has no name. */
  email: string | null;
  member: boolean;
  status: string | null;
  createdAt: string;
  signedUpWith: SignInMethod | null;
  /** Every way in linked to the account now. */
  methods: SignInMethod[];
  /** The latest ever, whatever the period. */
  lastSignInAt: string | null;
  lastSignInMethod: SignInMethod | null;
  lastSignInHomeScreen: boolean;
  /** In the period. */
  signIns: number;
  signInMethods: SignInMethod[];
  /** Null for an account with no invite yet. */
  cameBy: CameBy | null;
  askedForInvite: boolean;
}

export interface SignInMethods {
  asOf: string;
  period: StatsPeriod;
  /** The oldest sign-in recorded, or null before the first. */
  recordedSince: string | null;
  /** Of the accounts made in the period, by the way each was made. */
  signUps: Record<SignInMethod, number>;
  signIns: Record<SignInMethod, MethodCount>;
  /** Of the accounts made in the period, by the way each came. */
  cameBy: Partial<Record<CameBy['way'], number>>;
  /** Of those, the Home Screen app taking a browser's sign-in over. */
  homeScreen: MethodCount;
  /** Made or signed in to in the period, newest sign-in first. */
  accounts: SignInAccount[];
}

const LABELS: Record<string, string> = {
  email: 'Email and password',
  google: 'Google',
  apple: 'Apple',
  link: 'One-time link',
  oauth: 'Google or Apple',
  passkey: 'Passkey',
};

export function methodLabel(method: SignInMethod | null): string {
  return method ? (LABELS[method] ?? method) : 'Unknown';
}

const PHRASES: Record<string, string> = { link: 'a one-time link' };

/** In a sentence: "signed in with a one-time link". */
export function methodPhrase(method: SignInMethod | null): string {
  return (method ? PHRASES[method] : undefined) ?? methodLabel(method);
}

const ORDER = ['email', 'google', 'apple'];

/** Today's three always, with nothing as 0; then any other, a link last. */
export function methodOrder(present: SignInMethod[]): SignInMethod[] {
  const others = present
    .filter((m) => !ORDER.includes(m) && m !== 'link')
    .sort((a, b) => a.localeCompare(b));
  return [...ORDER, ...others, ...(present.includes('link') ? ['link'] : [])];
}

export const CAME_LABELS: Record<CameBy['way'], string> = {
  qr: 'QR code',
  organization: 'Invited by an organization',
  member: 'Invited by a member',
  open: 'While joining was open',
};

const CAME_BY_CODE: Record<NonNullable<CameBy['madeAs']>, string> = {
  qr: 'QR code',
  link: 'invite link',
  qr_and_link: 'QR code or its invite link',
  share: 'a shared post’s link',
};

/** When a code was made: "Nov 20, 2026 at 3:05 PM"; null for a date that does not read. */
export function madeWhen(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

/**
 * "Came by invite link from NorCal SCI, at Abilities Expo, made by Alfred
 * Shaheen on Nov 20, 2026 at 3:05 PM, after asking for an invite." Who made
 * the code, when and how: the owner, 2026-11-25.
 */
export function cameByPhrase({ cameBy, askedForInvite }: SignInAccount): string | null {
  if (!cameBy) return askedForInvite ? 'Asked for an invite.' : null;
  const { way, by, event } = cameBy;
  const asked = askedForInvite ? ', after asking for an invite' : '';
  if (way === 'open') return `Came while joining was open${asked}.`;
  if (way === 'qr') {
    const what = cameBy.madeAs ? CAME_BY_CODE[cameBy.madeAs] : 'QR code';
    const where = event && event !== by ? `, at ${event}` : '';
    const when = cameBy.madeAt ? madeWhen(cameBy.madeAt) : null;
    const made =
      'madeBy' in cameBy
        ? `, ${cameBy.madeAs === 'share' ? 'shared' : 'made'} by ${cameBy.madeBy ?? 'somebody no longer in the club'}${when ? ` on ${when}` : ''}`
        : '';
    return `Came by ${what}${by ? ` from ${by}` : ''}${where}${made}${asked}.`;
  }
  return `Came by invite${by ? ` from ${by}` : ''}${asked}.`;
}

export async function fetchSignInMethods(
  period: StatsPeriod,
): Promise<{ ok: true; methods: SignInMethods } | { ok: false; error: string }> {
  const { data, error } = (await getSupabase().rpc('admin_sign_in_methods', { period })) as {
    data: SignInMethods | null;
    error: Parameters<typeof describeError>[0] | null;
  };
  if (error || !data)
    return {
      ok: false,
      error: error
        ? describeError(error, 'Could not load how members sign in.')
        : 'Could not load how members sign in.',
    };
  return { ok: true, methods: data };
}

export function useSignInMethods(period: StatsPeriod) {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSignInMethods(period);
    if (result.ok) {
      setMethods(result.methods);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  return { methods, error, reload: load };
}
