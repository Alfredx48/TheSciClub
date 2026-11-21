import { SPOKES, type Wheel } from '@/lib/wheelies';

/**
 * The level's colour: the injury pills' ten bands, green to dark purple,
 * lightened on a dark page (--wheel-lift) so the darkest still show.
 */
function levelColor(wheel: Wheel): string {
  return `color-mix(in oklab, var(--band-${wheel.level.level - 1}), white var(--wheel-lift, 0%))`;
}

/**
 * The 2-pager's wheel: a rim, a hub and seven spokes, all lines in the level's
 * colour; the spokes earned so far solid, the rest faint.
 */
export function WheelIcon({ wheel, className }: { wheel: Wheel; className?: string }) {
  const color = levelColor(wheel);
  // The rim's outer edge meets the box.
  const rim = 10.9;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r={rim} fill="none" stroke={color} strokeWidth="2.2" />
      {Array.from({ length: SPOKES }, (_, i) => {
        const angle = ((-90 + (i * 360) / SPOKES) * Math.PI) / 180;
        const filled = i < wheel.spokes;
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: the spokes are fixed and never move.
            key={i}
            x1="12"
            y1="12"
            x2={12 + (rim - 1.2) * Math.cos(angle)}
            y2={12 + (rim - 1.2) * Math.sin(angle)}
            stroke={color}
            strokeOpacity={filled ? 1 : 0.5}
            strokeWidth={filled ? 2 : 1.6}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="12" cy="12" r="2" fill={color} />
    </svg>
  );
}
