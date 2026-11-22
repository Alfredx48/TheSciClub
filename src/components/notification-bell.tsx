import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUnseenNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';

/**
 * The way to the notifications list, with what has arrived since it was last
 * opened.
 *
 * Home's header and Me's on a phone, and the end of the top bar on a desktop.
 * `variant` is which: `plate` is on Me's navy band.
 *
 * The number is in the link's name ("Notifications, 3 new"), and drawn as a
 * number rather than a dot so it says how much; past nine it says "9+", which
 * is all the badge has room for at the largest text size.
 */
export function NotificationBell({
  variant,
  className,
}: {
  variant: 'round' | 'plate' | 'bar';
  className?: string;
}) {
  const { count, loaded } = useUnseenNotifications();
  const ring = useRing(count, loaded);
  const label = count > 0 ? `Notifications, ${count} new` : 'Notifications';
  const badge =
    count > 0 ? (
      <span
        aria-hidden="true"
        className="-top-1 -right-1 absolute grid h-[1.35em] min-w-[1.35em] place-items-center rounded-full bg-destructive-fill px-1 font-bold text-[0.6875rem] text-white leading-none ring-2 ring-paper"
      >
        {count > 9 ? '9+' : count}
      </span>
    ) : null;

  if (variant !== 'bar') {
    return (
      <Link
        to="/notifications"
        aria-label={label}
        className={cn(
          'relative grid h-[44px] w-[44px] flex-none place-items-center rounded-full transition-colors',
          variant === 'round' ? 'bg-tint hover:bg-line' : 'bg-plate-chip hover:bg-plate-hover',
          className,
        )}
      >
        <Bell
          key={ring}
          aria-hidden="true"
          className={cn(
            'h-[19px] w-[19px]',
            variant === 'round' ? 'text-emphasis' : 'text-white',
            ring > 0 && 'bell-ring',
          )}
          strokeWidth={2}
        />
        {badge}
      </Link>
    );
  }

  return (
    <Link
      to="/notifications"
      aria-label={label}
      className={cn(
        'relative flex items-center gap-1.5 rounded-xl px-2 py-1 font-bold text-[0.8125rem] text-grey hover:bg-tint lg:px-2.5',
        className,
      )}
    >
      <span className="relative grid h-6 w-6 place-items-center rounded-[10px]">
        <Bell
          key={ring}
          aria-hidden="true"
          className={cn('h-[18px] w-[18px]', ring > 0 && 'bell-ring')}
        />
        {badge}
      </span>
      {/* The bell alone on an iPad held upright: the word did not fit beside
          five tabs at a larger text size. Its name is the link's label. */}
      <span className="hidden lg:inline">Notifications</span>
    </Link>
  );
}

/**
 * Goes up by one each time the count rises after it first loads; keyed on
 * the bell, so each rise swings it once. Zero: no swing yet.
 */
function useRing(count: number, loaded: boolean | undefined): number {
  const [ring, setRing] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (last.current !== null && count > last.current) setRing((n) => n + 1);
    last.current = count;
  }, [count, loaded]);
  return ring;
}

// Tailwind's `md`, as src/index.css sets it: 44rem (704px).
const WIDE = '(min-width: 704px)';

/**
 * Whether the desktop layout (`md`) is showing, so only the bell that can be
 * seen is mounted. Both used to be mounted with one hidden by CSS, and each
 * bell reads the count and keeps its own realtime channel (2026-10-14). Null
 * where the browser cannot say: then both are mounted, as before.
 */
export function useWideLayout(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(WIDE).matches : null,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const changed = () => {
      setWide(query.matches);
    };
    query.addEventListener('change', changed);
    return () => {
      query.removeEventListener('change', changed);
    };
  }, []);
  return wide;
}
