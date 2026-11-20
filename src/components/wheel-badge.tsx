import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@/lib/dialog-focus';
import { cn } from '@/lib/utils';
import { pointsInWords, SPOKES, useWheeliePoints, type Wheel, wheelOf } from '@/lib/wheelies';

/**
 * A member's Wheelie points as a wheelchair wheel beside their name, next to
 * their injury (the owner's 2-pager, 2026-11-20): its colour is their level,
 * green through orange and red to dark purple as the injury pills go, and its
 * seven spokes fill as they earn towards the next. Pressed, it says the level
 * and the count, so the colour is never the only way to know.
 *
 * `still` draws it without the press, inside something that is already a
 * link or a button (a card that opens the profile); it is still said aloud.
 */
export function WheelBadge({
  memberId,
  name,
  still = false,
  className,
}: {
  memberId: string | null | undefined;
  /** Whose wheel, for the sheet's heading: "Ana's wheel". */
  name?: string;
  still?: boolean;
  className?: string;
}) {
  const points = useWheeliePoints(memberId);
  const [open, setOpen] = useState(false);
  if (points === null) return null;
  const wheel = wheelOf(points);
  const said = `Wheel level ${wheel.level.level}, ${wheel.level.name.toLowerCase()}, ${pointsInWords(wheel.points)} Wheelie points`;
  const icon = <WheelIcon wheel={wheel} className="h-full w-full" />;
  if (still) {
    return (
      <span
        role="img"
        aria-label={said}
        title={said}
        className={cn('inline-block h-[1.1em] w-[1.1em] flex-none align-[-0.18em]', className)}
      >
        {icon}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label={said}
        title={said}
        onClick={(event) => {
          // A byline sits inside links and cards; the wheel opens itself only.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'relative inline-flex h-[1.1em] w-[1.1em] flex-none items-center justify-center rounded-full align-[-0.18em] after:absolute after:-inset-2.5 after:content-[""]',
          className,
        )}
      >
        {icon}
      </button>
      {open ? (
        <WheelSheet
          wheel={wheel}
          name={name}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The level's colour: the injury pills' ten bands, green to dark purple. */
function levelColor(wheel: Wheel): string {
  return `var(--band-${wheel.level.level - 1})`;
}

export function WheelIcon({ wheel, className }: { wheel: Wheel; className?: string }) {
  const rim = 8.4;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="11.25" fill={levelColor(wheel)} />
      <circle
        cx="12"
        cy="12"
        r={rim}
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      {Array.from({ length: SPOKES }, (_, i) => {
        const angle = ((-90 + (i * 360) / SPOKES) * Math.PI) / 180;
        const filled = i < wheel.spokes;
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: the spokes are fixed and never move.
            key={i}
            x1="12"
            y1="12"
            x2={12 + rim * Math.cos(angle)}
            y2={12 + rim * Math.sin(angle)}
            stroke="white"
            strokeOpacity={filled ? 1 : 0.3}
            strokeWidth={filled ? 1.7 : 1.1}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="12" cy="12" r="2.1" fill="white" />
    </svg>
  );
}

function WheelSheet({
  wheel,
  name,
  onClose,
}: {
  wheel: Wheel;
  name: string | undefined;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useDialogFocus(dialog, heading, onClose);
  const first = name?.trim().split(/\s+/)[0];

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-[rgba(10,20,35,.5)]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-[81] max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-paper p-5 text-ink shadow-xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[360px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl"
      >
        <div className="flex items-center gap-3.5">
          <WheelIcon wheel={wheel} className="h-14 w-14 flex-none" />
          <div className="min-w-0">
            <h2
              id={titleId}
              ref={heading}
              tabIndex={-1}
              className="font-bold font-head text-lg leading-tight outline-none"
            >
              {first ? `${first}’s wheel` : 'Wheel'}: level {wheel.level.level}
            </h2>
            <p className="mt-0.5 text-[0.875rem] text-grey">{wheel.level.name}</p>
          </div>
        </div>
        <p className="mt-4 font-extrabold font-head text-[1.5rem] leading-none">
          {pointsInWords(wheel.points)}{' '}
          <span className="font-semibold text-[0.9375rem] text-ink2">Wheelie points</span>
        </p>
        <p className="mt-2 text-[0.875rem] text-ink2 leading-[1.45]">
          {wheel.next
            ? `${pointsInWords(wheel.next.from - wheel.points)} more to level ${wheel.next.level}, ${wheel.next.name.toLowerCase()}. Each spoke is a seventh of the way.`
            : 'The top level.'}
        </p>
        <p className="mt-3 text-[0.8125rem] text-grey leading-[1.45]">
          Members earn Wheelie points for taking part: asking and answering questions, coming to
          events, writing reviews and completing their profile.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-12 w-full rounded-xl border border-line font-semibold"
        >
          Done
        </button>
      </div>
    </>,
    document.body,
  );
}
