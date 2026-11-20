import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { standingRefusal, useAnonymousStanding } from '@/lib/chat/anonymous';
import { strikePath } from '@/lib/strike-conversations';
import { ruleName } from '@/lib/strike-rules';
import { cn } from '@/lib/utils';
import { LOSING_MEMBERSHIP_ID } from '@/routes/legal/legal-page';
import { countingStrikes, type MyStrike, STRIKE_MONTHS } from '@/routes/me/standing-api';

/**
 * Where a member stands, and why.
 *
 * ---------------------------------------------------------------------------
 * The card had one thing to say and said it to everybody
 * ---------------------------------------------------------------------------
 * It read "Good standing" and listed the four things that end a membership,
 * whatever had actually happened. CONTEXT.md asks that losing membership stay
 * reachable in the product — and a warning a member cannot see is further from
 * reachable than a terms page is.
 *
 * So the card reports the state: the count, each strike, the reason, and the
 * date. The reason especially. Being told you are on two strikes without being
 * told what for is the thing that makes somebody leave quietly rather than
 * correct course, and it is not a punishment anybody decided to hand down.
 *
 * ---------------------------------------------------------------------------
 * Three pause, and three more close (20261120110000)
 * ---------------------------------------------------------------------------
 * The third strike pauses the membership for 30 days by itself, and three
 * after that close the account for good (the owner, 2026-11-20). A flag on an
 * anonymous post is a strike like any other, listed here with its reason,
 * which only the member sees. Strikes from before a pause no longer count.
 *
 * Withdrawn and expired strikes are not listed. They are on the record and an
 * administrator can see them, but a member reading where they stand today is
 * owed what counts today, not an archive of things that no longer do.
 */

function whenIssued(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface Standing {
  title: string;
  Icon: typeof ShieldCheck;
  tone: string;
  /** Said under the count, when there is something to add to it. */
  consequence: string | null;
}

export function standingFor(counting: number, afterPause = false): Standing {
  if (counting === 0) {
    return { title: 'Good standing', Icon: ShieldCheck, tone: 'text-gold-dp', consequence: null };
  }
  if (counting === 1) {
    return {
      title: 'One strike',
      Icon: ShieldAlert,
      tone: 'text-gold-dp',
      consequence: afterPause
        ? `It stops counting ${STRIKE_MONTHS} months after the date shown. Since your pause, three strikes close your account for good.`
        : `It stops counting ${STRIKE_MONTHS} months after the date shown.`,
    };
  }
  if (counting === 2) {
    return {
      title: 'Two strikes',
      Icon: ShieldAlert,
      tone: 'text-destructive',
      consequence: afterPause
        ? 'One more closes your account for good.'
        : 'One more pauses your membership for 30 days.',
    };
  }
  return {
    title: 'Your membership is paused',
    Icon: ShieldX,
    tone: 'text-destructive',
    consequence: 'Three strikes pause a membership for 30 days.',
  };
}

export function StandingCard({
  invitedBy,
  strikes,
  afterPause = false,
}: {
  invitedBy: string | null;
  strikes: MyStrike[] | null;
  /** Paused for strikes before: the next three close the account. */
  afterPause?: boolean;
}) {
  const counting = strikes ? countingStrikes(strikes) : [];
  const standing = standingFor(counting.length, afterPause);
  // Flagged anonymous posts stop anonymous posting for a while (20261120110000).
  const anonymous = standingRefusal(useAnonymousStanding());
  const { Icon } = standing;

  return (
    <div
      className={cn(
        'rounded-[17px] border p-3.5',
        counting.length >= 2 ? 'border-destructive/40 bg-destructive/5' : 'border-line bg-paper',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon className={cn('h-5 w-5 flex-none', standing.tone)} />
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold font-head text-[0.9375rem] text-ink">
            {standing.title}
          </span>
          {invitedBy ? (
            <span className="block text-[0.78125rem] text-grey">Invited by {invitedBy}</span>
          ) : null}
        </span>
      </div>

      {counting.length > 0 ? (
        <>
          <div className="my-3 h-px bg-line" />
          <ul className="flex flex-col gap-2.5">
            {counting.map((strike) => (
              <li key={strike.id}>
                <p className="font-bold text-[0.8125rem] text-ink leading-[1.45]">
                  {ruleName(strike.rule) ?? strike.reason}
                </p>
                {ruleName(strike.rule) ? (
                  <p className="text-[0.8125rem] text-ink2 leading-[1.45]">{strike.reason}</p>
                ) : null}
                <p className="mt-0.5 text-[0.75rem] text-grey">
                  {strike.anonymous
                    ? `Anonymous post flagged · ${whenIssued(strike.issuedAt)}`
                    : whenIssued(strike.issuedAt)}
                  {' · '}
                  {/* Every strike can be answered (the owner, 2026-11-20; 20261120120000). */}
                  <Link
                    to={strikePath(strike.kind, strike.id)}
                    data-target="small"
                    className="font-semibold text-emphasis underline"
                  >
                    Respond
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          {standing.consequence ? (
            <p className="mt-2.5 font-bold text-[0.78125rem] text-ink2 leading-[1.5]">
              {standing.consequence}
            </p>
          ) : null}
          {anonymous ? (
            <p className="mt-1.5 text-[0.78125rem] text-ink2 leading-[1.5]">{anonymous}</p>
          ) : null}
        </>
      ) : null}

      <div className="my-3 h-px bg-line" />
      <HouseRules />
    </div>
  );
}

/** To the Terms' list of what ends a membership (the owner, 2026-10-28). */
function HouseRules() {
  return (
    <Link
      to={`/terms#${LOSING_MEMBERSHIP_ID}`}
      data-target="small"
      className="rounded font-semibold text-[0.78125rem] text-emphasis underline decoration-emphasis/30 underline-offset-2 transition-colors hover:decoration-emphasis"
    >
      What can end a membership
    </Link>
  );
}
