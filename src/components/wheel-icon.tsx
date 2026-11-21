import { SPOKES, type Wheel } from '@/lib/wheelies';

/**
 * The level's colour: the injury pills' ten bands, green to dark purple,
 * lightened on a dark page (--wheel-lift) so the darkest still show.
 */
function levelColor(wheel: Wheel): string {
  return `color-mix(in oklab, var(--band-${wheel.level.level - 1}), white var(--wheel-lift, 0%))`;
}

/**
 * The 2-pager's wheel, as a wheelchair's: a tyre, the push rim just inside
 * it, a hub and seven thin spokes (the owner, 2026-11-21), all lines in the
 * level's colour; the spokes earned so far solid, the rest faint.
 */
export function WheelIcon({ wheel, className }: { wheel: Wheel; className?: string }) {
  const color = levelColor(wheel);
  // The tyre's outer edge meets the box; the push rim sits a gap inside it,
  // and the spokes end at the push rim so the gap is one even ring.
  const rim = 10.9;
  const pushRim = 8.3;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r={rim} fill="none" stroke={color} strokeWidth="2.2" />
      <circle cx="12" cy="12" r={pushRim} fill="none" stroke={color} strokeWidth="1.3" />
      {Array.from({ length: SPOKES }, (_, i) => {
        const angle = ((-90 + (i * 360) / SPOKES) * Math.PI) / 180;
        const filled = i < wheel.spokes;
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: the spokes are fixed and never move.
            key={i}
            x1="12"
            y1="12"
            x2={12 + pushRim * Math.cos(angle)}
            y2={12 + pushRim * Math.sin(angle)}
            stroke={color}
            strokeOpacity={filled ? 1 : 0.5}
            strokeWidth={filled ? 1.2 : 0.9}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="12" cy="12" r="1.8" fill={color} />
    </svg>
  );
}
