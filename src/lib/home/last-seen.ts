/**
 * What this device last saw, so the app can open on it at once and read the
 * new behind it (the owner, 2026-11-21: "Show the last feed from the phone
 * instantly on later openings, then refresh it quietly").
 *
 * - The member the door last let in: their id, name and whether an
 *   administrator. Used only while this device still holds that member's own
 *   session, and only until the door's own read answers, a moment later; if
 *   that says paused or removed, they are sent on as always.
 * - Home's feed for the default view, as home_feed answered it, kept a week.
 *
 * Both are this member's own, already on this device, and both go at sign-out
 * (lib/account.tsx) so the next person on it sees neither.
 */
import { sessionStorageKey } from '@/lib/url-session';

const MEMBER_KEY = 'club:last-member';
const FEED_PREFIX = 'club:home-feed:';
const FEED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface LastMember {
  userId: string;
  isAdmin: boolean;
  displayName: string | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The member whose session this device holds now, if any. */
function sessionUser(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const store = storage();
  if (!url || !store) return null;
  try {
    const session = JSON.parse(store.getItem(sessionStorageKey(url)) ?? 'null') as {
      user?: { id?: unknown };
    } | null;
    return typeof session?.user?.id === 'string' ? session.user.id : null;
  } catch {
    return null;
  }
}

export function rememberMember(member: LastMember): void {
  try {
    storage()?.setItem(MEMBER_KEY, JSON.stringify(member));
  } catch {
    // Full or blocked: the door reads as before next time.
  }
}

/** The member the door last let in, if this device still holds their session. */
export function lastMember(): LastMember | null {
  const store = storage();
  if (!store) return null;
  try {
    const member = JSON.parse(store.getItem(MEMBER_KEY) ?? 'null') as LastMember | null;
    if (!member || typeof member.userId !== 'string') return null;
    return member.userId === sessionUser() ? member : null;
  } catch {
    return null;
  }
}

export function saveHomeFeed(userId: string, rows: readonly unknown[]): void {
  try {
    storage()?.setItem(`${FEED_PREFIX}${userId}`, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    // Full or blocked: Home reads as before next time.
  }
}

/** Home's last feed for this member, if a week old or newer. */
export function lastHomeFeed(userId: string): unknown[] | null {
  try {
    const kept = JSON.parse(storage()?.getItem(`${FEED_PREFIX}${userId}`) ?? 'null') as {
      at?: unknown;
      rows?: unknown;
    } | null;
    if (!kept || typeof kept.at !== 'number' || Date.now() - kept.at > FEED_KEEP_MS) return null;
    return Array.isArray(kept.rows) ? kept.rows : null;
  } catch {
    return null;
  }
}

/** At sign-out, or when the door turns somebody away: nothing of theirs stays. */
export function forgetLastSeen(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(MEMBER_KEY);
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key?.startsWith(FEED_PREFIX)) store.removeItem(key);
    }
  } catch {
    // Blocked: there was nothing kept either.
  }
}
