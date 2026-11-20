import { PauseCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { signOut, useAccount } from '@/lib/account';
import { pauseEnds } from '@/lib/chat/anonymous';
import { useOwnMember } from '@/lib/members';
import { ruleName } from '@/lib/strike-rules';
import { getSupabase } from '@/lib/supabase';
import { countingStrikes, loadMyStrikes, type MyStrike } from '@/routes/me/standing-api';
import { StrikeConversation } from '@/routes/strikes/strike-conversation';

/**
 * When a pause for strikes ends (member_strike_pauses, 20261120110000), or null for a pause an
 * administrator made by hand, which has no end date.
 */
function useStrikePauseEnd(memberId: string | null): string | null {
  const [ends, setEnds] = useState<string | null>(null);
  useEffect(() => {
    if (!memberId) return;
    const run = { live: true };
    void (async () => {
      // A database before 20261120110000, or none: the screen for a pause by hand.
      const { data } = (await getSupabase()
        .from('member_strike_pauses')
        .select('ends_at')
        .eq('member_id', memberId)
        .is('lifted_at', null)
        .order('paused_at', { ascending: false })
        .limit(1)) as { data: { ends_at: string }[] | null };
      if (run.live) setEnds(data?.[0]?.ends_at ?? null);
    })().catch(() => undefined);
    return () => {
      run.live = false;
    };
  }, [memberId]);
  return ends;
}

/**
 * The strikes behind a pause, which a paused member can still respond to (the owner, 2026-11-20:
 * "there should be an opportunity for them to respond"; 20261120120000).
 */
function useStrikesBehindPause(memberId: string | null, paused: boolean): MyStrike[] {
  const [strikes, setStrikes] = useState<MyStrike[]>([]);
  useEffect(() => {
    if (!memberId || !paused) return;
    const run = { live: true };
    void loadMyStrikes(memberId, false)
      .then((result) => {
        if (run.live && result.ok) setStrikes(countingStrikes(result.strikes));
      })
      .catch(() => undefined);
    return () => {
      run.live = false;
    };
  }, [memberId, paused]);
  return strikes;
}

/**
 * The membership is paused, and the person it belongs to is told so.
 *
 * Suspension existed in the database and in `/admin` from the beginning and
 * did nothing a member could perceive: the row was read without its status, so
 * a suspended member resolved to an ordinary one and walked in. What they
 * found was an empty Peers deck and no events — `browse_members` and the
 * event views filter on status — with nothing anywhere saying why. A club
 * whose stated sanction is losing membership cannot apply it invisibly.
 *
 * Written as a pause, not an error, and not as an accusation. It is reversible
 * by design — `/admin` has Reactivate beside Suspend — so the copy says that
 * plainly rather than reading like a verdict.
 *
 * Who to ask is the part that has to be true. There is no messaging in the
 * club (CONTEXT.md), so rather than invent a contact route this names whoever
 * vouched for them, which `my_invited_by()` will answer for a suspended member
 * as readily as an active one. When it answers nothing, the screen says less
 * rather than pointing somewhere wrong — the same rule the blocked screen
 * follows about naming organizations.
 */
export function SuspendedScreen() {
  const { userId } = useAccount();
  const { invitedBy } = useOwnMember(userId);
  const [busy, setBusy] = useState(false);
  const strikeEnds = useStrikePauseEnd(userId);
  const strikes = useStrikesBehindPause(userId, strikeEnds !== null);
  const [answering, setAnswering] = useState<MyStrike | null>(null);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-[18px] pt-12">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] bg-gold-lt text-gold-dp">
          <PauseCircle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-extrabold font-display text-[1.5625rem] text-ink leading-tight tracking-[-0.01em]">
          Your membership is paused
        </h1>
        {/* No name in front of this. "Dana, an administrator has paused your
            membership" reads for a moment as though Dana were the
            administrator, which is the wrong sentence to have to re-read on
            this screen. */}
        {strikeEnds ? (
          <>
            <p className="mt-2.5 text-[0.8875rem] text-ink2 leading-[1.52]">
              Your membership of The SCI Club is paused for 30 days, after three strikes. While it
              is paused you cannot see other members, and they cannot see you.
            </p>
            <p className="mt-2.5 text-[0.8875rem] text-ink2 leading-[1.52]">
              It comes back on its own on {pauseEnds(strikeEnds)}, and your strikes start again from
              zero. Nothing on your profile has been deleted. You can no longer post anonymously.
              Three more strikes after that close your account for good.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2.5 text-[0.8875rem] text-ink2 leading-[1.52]">
              An administrator has paused your membership of The SCI Club. While it is paused you
              cannot see other members, and they cannot see you.
            </p>
            <p className="mt-2.5 text-[0.8875rem] text-ink2 leading-[1.52]">
              This can be lifted. Nothing on your profile has been deleted.
            </p>
          </>
        )}

        {strikes.length > 0 ? (
          <section aria-label="Your strikes" className="mt-4">
            <h2 className="font-extrabold font-head text-[0.71875rem] text-grey uppercase tracking-[0.13em]">
              Your strikes
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {strikes.map((strike) => (
                <li
                  key={strike.id}
                  className="rounded-[14px] border border-line bg-paper px-3.5 py-3"
                >
                  <p className="font-bold text-[0.8125rem] text-ink leading-[1.45]">
                    {ruleName(strike.rule) ?? strike.reason}
                  </p>
                  {ruleName(strike.rule) ? (
                    <p className="text-[0.8125rem] text-ink2 leading-[1.45]">{strike.reason}</p>
                  ) : null}
                  <p className="mt-0.5 text-[0.75rem] text-grey">
                    {strike.anonymous ? 'Anonymous post flagged · ' : ''}
                    {new Date(strike.issuedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAnswering(answering?.id === strike.id ? null : strike);
                    }}
                    aria-expanded={answering?.id === strike.id}
                    className="inline-flex min-h-[44px] items-center font-semibold text-[0.84375rem] text-emphasis underline"
                  >
                    {answering?.id === strike.id ? 'Close' : 'Respond'}
                  </button>
                  {answering?.id === strike.id ? (
                    <div className="mt-2 border-line border-t pt-3">
                      <StrikeConversation kind={strike.kind} id={strike.id} isAdmin={false} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {invitedBy ? (
          <div className="mt-4 rounded-[17px] border border-line bg-paper px-3.5 py-3.5">
            <p className="text-[0.78125rem] text-grey leading-[1.5]">
              {invitedBy} invited you to the club. They are the people to ask about it.
            </p>
          </div>
        ) : null}

        {/* The rules, stated rather than linked — the same reason the Standing
            card on Me states them: CONTEXT.md asks that losing membership stay
            visible in the product, and this is the screen where that matters
            most. */}
        <p className="mt-4 text-[0.78125rem] text-grey leading-[1.55]">
          Strikes are for harassment, medical claims as fact, selling or advertising outside the
          Marketplace, spam and careless sharing. Threats, scams and exposing someone end a
          membership at once.
        </p>
      </div>

      <div className="flex-none px-[18px] pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => {
              setBusy(false);
            });
          }}
          className="flex min-h-[48px] w-full items-center justify-center rounded-[13px] border-[1.6px] border-line font-bold font-head text-[0.9375rem] text-ink2 disabled:opacity-40"
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
