/**
 * The door check and Home's feed, asked for by index.html while the app's
 * script downloads (the owner, 2026-11-21: opening on Home on a slow phone
 * waited a second for the script before asking for either). Taken once, by
 * the account (src/lib/account.tsx), and only for the member whose session
 * started them; anything that did not come is read again as before.
 */

interface EarlyStart {
  user: string;
  at: number;
  member: Promise<unknown>;
  feed: Promise<unknown>;
}

declare global {
  interface Window {
    __clubEarly?: EarlyStart | undefined;
  }
}

/** Too old to stand for this opening: the page has been open a while. */
const STALE_MS = 30_000;

export interface EarlyReads {
  /** The member's own row (id, is_admin, display_name, status), or null: none. */
  member: Promise<Record<string, unknown> | null>;
  /** home_feed's rows for the default view, or null to read again. */
  feed: Promise<unknown[] | null>;
}

/** The early reads for `userId`, once; undefined when none were started for them. */
export function takeEarlyStart(userId: string): EarlyReads | undefined {
  if (typeof window === 'undefined') return undefined;
  const early = window.__clubEarly;
  window.__clubEarly = undefined;
  if (early?.user !== userId || Date.now() - early.at > STALE_MS) return undefined;
  return {
    // The filter asks for one row: an empty list is no row, a member yet to join.
    member: early.member.then((rows) => {
      if (!Array.isArray(rows)) throw new Error('Unexpected answer.');
      return (rows[0] as Record<string, unknown> | undefined) ?? null;
    }),
    feed: early.feed.then(
      (rows) => (Array.isArray(rows) ? rows : null),
      () => null,
    ),
  };
}
