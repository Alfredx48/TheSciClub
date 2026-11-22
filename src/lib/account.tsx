import type { Session } from '@supabase/supabase-js';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext } from '@/lib/account-context';
import { forgetTrail } from '@/lib/back-trail';
import { resetAttachmentUrls } from '@/lib/chat/attachments';
import { forgetDrafts } from '@/lib/chat/drafts';
import { describeError, describeThrown } from '@/lib/describe-error';
import { takeEarlyStart } from '@/lib/early-start';
import { readHomeFeed } from '@/lib/home/feed-read';
import { forgetLastSeen, lastMember, rememberMember } from '@/lib/home/last-seen';
import { DEFAULT_HOME_VIEW } from '@/lib/home/types';
import { ownRowChanged, readOwnRow, type SharedRow } from '@/lib/own-row';
import { forgetThisDevice } from '@/lib/push/notifications';
import { forgetSharedReads } from '@/lib/shared-reads';
import { getSupabase } from '@/lib/supabase';

/**
 * Where somebody stands with the club, in one answer.
 *
 * Three states rather than a boolean, because they lead to three different
 * places:
 *
 *  - `signed-out`      — no session. Start at the welcome screen.
 *  - `signed-up`       — has an account (an email, Google, Apple) but no member
 *                        row yet, because they abandoned the wizard partway.
 *                        Send them back into it rather than into an app with no
 *                        profile behind them.
 *  - `member`          — a row in `members`. Let them in.
 *
 * The membership check reads the viewer's own row through `members`, which is
 * own-row-only by RLS: it returns their row or nothing, and never anybody
 * else's.
 */

export type AccountStatus =
  | 'loading'
  | 'error'
  | 'signed-out'
  | 'signed-up'
  | 'member'
  /**
   * A member row exists and is not active.
   *
   * Kept apart from 'member' rather than folded into it, because the app used
   * to fold it in: the row was read without its status, so a suspended member
   * resolved to 'member' and walked into the club. They saw an empty deck and
   * no events — `browse_members` and the event views filter on status — with
   * nothing anywhere saying why. Suspension is the club's reversible sanction
   * and it has to be visible to the person it is applied to.
   */
  | 'suspended';

export interface Account {
  status: AccountStatus;
  userId: string | null;
  /** Read from the member's own row, which RLS already scopes to them. */
  isAdmin: boolean;
  /** Who you are signed in as. Null until the member row is read. */
  displayName: string | null;
  error?: string;
  retry?: () => void;
  takeInitialHomeFeed?: () => Promise<unknown[] | null> | undefined;
  /**
   * Let in on what this device last saw (lib/home/last-seen.ts) while the
   * door's own read is still out: screens draw what they kept, and read the
   * club's data only once this is gone (the owner, 2026-11-21).
   */
  provisional?: boolean;
}

/**
 * What the member row makes of the person holding it.
 *
 * A pure function because the branch is the whole of suspension: it used to
 * read `row ? 'member' : 'signed-up'`, with the status never selected, so a
 * suspended member became an ordinary one and walked into an empty club.
 *
 * 'removed' sits with 'suspended'. Deletion takes the row out entirely, so a
 * row still saying 'removed' is a membership ended without the row going —
 * not active either way, and owed the same explanation.
 */
export function statusFor(row: { status?: unknown } | null | undefined): AccountStatus {
  if (!row) return 'signed-up';
  return String(row.status) === 'active' ? 'member' : 'suspended';
}

/**
 * The account, read once for the whole club.
 *
 * `useAccount` was a read per caller: seven `members` reads on one Home load
 * (the guard, the bells, the unread dot, likes, views, the opening prompt),
 * and seven more at every token refresh (2026-10-14). Inside the club the
 * guard (RequireMember) now holds the one read and every screen shares it;
 * outside it (joining, the survey) each caller still reads its own, as before.
 * The guard reads again on each route change, so a change to the member's own
 * row (made an administrator, say) still shows on the next screen.
 */
export function AccountProvider({
  account,
  children,
}: {
  account: Account;
  children: React.ReactNode;
}) {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  const shared = useContext(AccountContext);
  const own = useOwnAccount({ enabled: shared === null });
  return shared ?? own;
}

const GUARD_COLUMNS = ['id', 'is_admin', 'display_name', 'status'];

function same(a: Account, b: Account): boolean {
  return (
    a.status === b.status &&
    a.userId === b.userId &&
    a.isAdmin === b.isAdmin &&
    a.displayName === b.displayName &&
    a.error === b.error &&
    a.takeInitialHomeFeed === b.takeInitialHomeFeed &&
    a.provisional === b.provisional
  );
}

/**
 * The read itself. `refresh` reads again without going back to loading, and
 * a refresh that fails keeps what was already known rather than turning a
 * member's screen into the error page over a dropped connection.
 */
export function useOwnAccount({
  enabled = true,
  refresh,
}: {
  enabled?: boolean;
  refresh?: unknown;
} = {}): Account {
  // The member this device last let in, while their session is still here:
  // the app opens on what it kept rather than on a spinner, and the read
  // below confirms them, or sends them on, a moment later.
  const [account, setAccount] = useState<Account>(() => {
    const last = enabled ? lastMember() : null;
    return last
      ? { status: 'member', ...last, provisional: true }
      : { status: 'loading', userId: null, isAdmin: false, displayName: null };
  });

  // A good answer is in hand, so a failed refresh need not replace it.
  const known = useRef(false);
  const [attempt, setAttempt] = useState(0);
  // When this screen was asked for: the door's read must be no older.
  const [opened, setOpened] = useState(() => ({ refresh, at: Date.now() }));
  if (opened.refresh !== refresh) setOpened({ refresh, at: Date.now() });

  const retry = useCallback(() => {
    ownRowChanged();
    known.current = false;
    setAccount((current) => ({ ...current, status: 'loading' }));
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const aborted = () => controller.signal.aborted;
    const supabase = getSupabase();
    const settle = (next: Account) => {
      known.current = next.status !== 'error';
      // What the next opening may start from: a member, and nobody else.
      if (next.status === 'member' && next.userId) {
        rememberMember({
          userId: next.userId,
          isAdmin: next.isAdmin,
          displayName: next.displayName,
        });
      } else if (next.status !== 'error') {
        forgetLastSeen();
      }
      setAccount((current) => (same(current, next) ? current : next));
    };
    const fail = (next: Account) => {
      if (known.current && !aborted()) return;
      settle(next);
    };

    let revision = attempt;
    // This run's screen: a row read before it is not enough for the door.
    let since = opened.at;
    // Whose membership this run has read or is reading.
    let reading: string | null | undefined;
    // getSession waits for the client to restore its session, and answers
    // for whatever it announces meanwhile (a restored session's SIGNED_IN
    // was a second read of the same row at every start).
    let answered = false;
    let earlyFeed: AbortController | undefined;
    async function resolve(session: Session | null) {
      if (aborted()) return;
      earlyFeed?.abort();
      earlyFeed = undefined;
      const userId = session?.user.id ?? null;
      reading = userId;
      const request = ++revision;
      if (!userId) {
        if (!aborted()) {
          settle({ status: 'signed-out', userId: null, isAdmin: false, displayName: null });
        }
        return;
      }
      try {
        // The shared row (lib/own-row.ts), but only one read since this
        // screen opened: a pause still shows on the next screen.
        // Opening on Home, index.html may have asked for both already, while
        // the script downloaded (lib/early-start.ts); what did not come is read here.
        const early = refresh === '/home' && !known.current ? takeEarlyStart(userId) : undefined;
        const membership: Promise<SharedRow> = early
          ? early.member.then(
              (row): SharedRow => ({ row, error: null }),
              () => readOwnRow(GUARD_COLUMNS, { since }),
            )
          : readOwnRow(GUARD_COLUMNS, { since });
        // First Home only. The feed obeys RLS and the shell still waits for membership.
        let initialHomeFeed: Promise<unknown[] | null> | undefined;
        if (refresh === '/home' && !known.current && session?.access_token) {
          earlyFeed = new AbortController();
          const { signal } = earlyFeed;
          const token = session.access_token;
          initialHomeFeed = early
            ? early.feed.then((rows) => rows ?? readHomeFeed(DEFAULT_HOME_VIEW, signal, token))
            : readHomeFeed(DEFAULT_HOME_VIEW, signal, token);
        }
        const shared = await membership;
        if (aborted() || request !== revision) return;
        if (shared?.error) throw shared.error;
        // Another account's row, signed in meanwhile: read alone.
        let row =
          shared && (shared.row === null || shared.row.id === userId) ? shared.row : undefined;
        if (row === undefined) {
          const result = await supabase
            .from('members')
            .select(GUARD_COLUMNS.join(', '))
            .eq('id', userId)
            .abortSignal(controller.signal)
            .maybeSingle();
          if (aborted() || request !== revision) return;
          if (result.error) throw result.error;
          row = result.data as Record<string, unknown> | null;
        }
        const status = statusFor(row);
        if (status !== 'member') earlyFeed?.abort();
        settle({
          status,
          ...(status === 'member' && initialHomeFeed
            ? {
                takeInitialHomeFeed: () => {
                  if (aborted() || request !== revision) return undefined;
                  const feed = initialHomeFeed;
                  initialHomeFeed = undefined;
                  return feed;
                },
              }
            : {}),
          userId,
          isAdmin: Boolean(row?.is_admin),
          displayName:
            typeof row?.display_name === 'string' && row.display_name ? row.display_name : null,
        });
      } catch (error) {
        if (aborted() || request !== revision) return;
        earlyFeed?.abort();
        fail({
          status: 'error',
          userId,
          isAdmin: false,
          displayName: null,
          error: describeThrown(error, 'Could not check your membership.'),
        });
      }
    }

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        answered = true;
        if (error) {
          if (!aborted())
            fail({ status: 'error', userId: null, isAdmin: false, displayName: null });
          return;
        }
        void resolve(data.session);
      })
      .catch(() => {
        answered = true;
        if (!aborted()) fail({ status: 'error', userId: null, isAdmin: false, displayName: null });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Sent to every new subscriber with the session getSession() above is
      // already resolving: reading for it too was the same read twice. And a
      // session restored from storage also announces SIGNED_IN, a token
      // refresh TOKEN_REFRESHED, for the same person: their row has not
      // changed, so only another person, a sign-out, or their own account
      // changing reads again.
      if (event === 'SIGNED_OUT') {
        void forgetDrafts();
        forgetLastSeen();
      }
      if (event === 'INITIAL_SESSION' || !answered) return;
      const userId = session?.user.id ?? null;
      if (event !== 'USER_UPDATED' && userId !== null && userId === reading) return;
      ownRowChanged();
      since = Date.now();
      void resolve(session);
    });

    return () => {
      controller.abort();
      earlyFeed?.abort();
      sub.subscription.unsubscribe();
    };
  }, [attempt, enabled, opened, refresh]);

  return useMemo(() => ({ ...account, retry }), [account, retry]);
}

/**
 * Sign out.
 *
 * `useAccount` is subscribed to auth changes, so the app reacts on its own:
 * the shell's guard sees a signed-out account and sends the person back to the
 * welcome screen. Nothing here has to navigate.
 */
export async function signOut(): Promise<{ ok: boolean; error?: string }> {
  // While the session still exists, since the row can only be deleted by its
  // owner: the next person to sign in on this phone must not get this
  // member's notifications. Its saved preference and browser subscription
  // survive so this member can resume on login. See forgetThisDevice.
  await forgetThisDevice();
  // This device only: the default, global, ends the member's other devices too.
  const { error } = await getSupabase().auth.signOut({ scope: 'local' });
  // Signed photograph URLs are kept across reloads (src/lib/chat/attachments.ts)
  // and were signed under this member's session. The next person on this
  // phone signs their own.
  if (!error) {
    resetAttachmentUrls();
    // Unsent words, which the next person on this device must not read.
    await forgetDrafts();
    // And the way back from where they were.
    forgetTrail();
    // And anything else held in memory for the screens (lib/shared-reads.ts).
    forgetSharedReads();
    // And what the next opening would have started from (lib/home/last-seen.ts).
    forgetLastSeen();
  }
  return error
    ? { ok: false, error: describeError(error, 'You are still signed in.') }
    : { ok: true };
}
