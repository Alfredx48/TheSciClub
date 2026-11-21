import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WheelIcon } from '@/components/wheel-icon';
import { pointsInWords, useWheelieBreakdown, wheelOf } from '@/lib/wheelies';

/**
 * A member's journey in the club: their wheel with their Wheelie points beside
 * it, opening where every point came from (the owner, 2026-11-20). On the Me
 * tab under Complete your profile (off members' profiles for now: the owner, 2026-11-21). Draws nothing
 * for somebody who does not earn them (an organization, a directory listing).
 */
export function JourneyCard({
  memberId,
  name,
  own,
}: {
  memberId: string;
  /** Whose, on somebody else's profile: "Ana's journey in the club". */
  name?: string | undefined;
  /** The reader's own: "Your journey in the club", opening /me/journey. */
  own: boolean;
}) {
  const breakdown = useWheelieBreakdown(memberId);
  if (breakdown === null) return null;
  const wheel = breakdown ? wheelOf(breakdown.total) : null;
  const first = name?.trim().split(/\s+/)[0];
  const title = own ? 'Your journey in the club' : `${first ?? 'Their'}’s journey in the club`;

  return (
    <Link
      to={own ? '/me/journey' : `/peers/${memberId}/journey`}
      state={own ? { from: 'me' } : undefined}
      className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-line bg-paper p-3.5 transition-colors hover:bg-tint"
    >
      {/* The box of Me's progress rings (4.7em at 0.75rem), so the words
        beside it start where theirs do. */}
      <span className="grid h-[4.7em] w-[4.7em] flex-none place-items-center text-[0.75rem]">
        {wheel ? (
          <WheelIcon wheel={wheel} className="h-[4em] w-[4em]" />
        ) : (
          <span aria-hidden="true" className="h-[4em] w-[4em] rounded-full border-2 border-line" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold font-head text-[0.96875rem] text-ink">{title}</span>
        <span className="mt-1 block text-[0.8125rem] text-ink2 leading-[1.5]">
          {breakdown ? `${pointsInWords(breakdown.total)} Wheelie points` : 'Wheelie points'}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="h-5 w-5 flex-none text-emphasis" />
    </Link>
  );
}
