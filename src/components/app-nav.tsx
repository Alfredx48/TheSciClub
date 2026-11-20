import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, type Location, useLocation } from 'react-router-dom';
import { litTab } from '@/components/lit-tab';
import { ChatIcon, EventsIcon, HomeIcon, MeIcon, PeersIcon } from '@/components/nav-icons';
import { NotificationBell, useWideLayout } from '@/components/notification-bell';
import { sayNext } from '@/lib/back-trail';
import { useBadgeRealtime } from '@/lib/badges';
import { useUnreadThreads } from '@/lib/chat/unread';
import { useUnprovenEmail } from '@/lib/email-proof';
import { useIconBadge } from '@/lib/icon-badge';
import { onReadsInFlight, readsInFlight, refreshTabReads } from '@/lib/kept-reads';
import { useUnseenNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';

/**
 * The five-tab bottom bar, matching `nav()` in docs/index.html.
 *
 * Every tab is a real screen. Home was the last placeholder, and was in the bar
 * from the start because leaving a hole there would have moved every other tab
 * once it landed. Since 2026-09-30 it is also where the app opens: `/` goes to
 * Home, so the first tab is the first screen. Until then `/` went to Peers,
 * while Home was built in steps and seen on the live club.
 *
 * ---------------------------------------------------------------------------
 * Chat is still not raised, and now carries a dot
 * ---------------------------------------------------------------------------
 * The mock gives the middle tab a badge behind its icon and this bar carried it
 * for a while. It was removed because the badge is the strongest mark in the
 * nav and it sat on the one tab that did nothing — the bar pointed hardest at
 * the only place with nothing to find.
 *
 * Chat is real now, and the raised tab still does not come back. A permanent
 * badge says "this is the important one" on every screen forever; a dot says
 * "somebody has written to you", which is a fact, and it disappears when it
 * stops being true. A count is not drawn: three unread conversations and one
 * are the same instruction, and the number would be the loudest thing in the
 * bar.
 */

const TABS = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/peers', label: 'Peers', Icon: PeersIcon },
  { to: '/chat', label: 'Chat', Icon: ChatIcon },
  { to: '/events', label: 'Events', Icon: EventsIcon },
  { to: '/me', label: 'Me', Icon: MeIcon },
] as const;

// Which tab a screen lights is lit-tab.ts, shared with the line back.
export { litTab } from '@/components/lit-tab';

/** At least this long, so a quick read still shows as a turn and not a flicker. */
export const TAB_SPIN_MIN_MS = 600;
/** A read not sent by then was not this tap's. */
const TAB_SPIN_WAIT_MS = 400;
/** However long the reads take, the spinner goes by then. */
const TAB_SPIN_MAX_MS = 10_000;

/**
 * Which tab spins: the one just tapped, while what it shows is read again
 * (the owner, 2026-11-19: "a loading spinner wheel maybe overlapping the tab
 * that was pressed"). It spins until the reads out after the tap have all
 * landed, failed or been dropped (lib/kept-reads.ts counts them), for at
 * least TAB_SPIN_MIN_MS and at most TAB_SPIN_MAX_MS.
 */
function useTabSpinner(location: Location): {
  spinning: string | null;
  tapped: (tab: string, destination: string) => boolean;
} {
  const pending = useRef<{ tab: string; at: number; destination: string } | null>(null);
  const [tap, setTap] = useState<typeof pending.current>(null);
  const [spinning, setSpinning] = useState<string | null>(null);
  useEffect(() => {
    // Back or a link elsewhere ends the pending tap, even if its reads are still out.
    if (pending.current && pending.current.destination !== location.pathname + location.search) {
      pending.current = null;
      setTap(null);
      setSpinning(null);
    }
  }, [location]);
  useEffect(() => {
    if (!tap) return;
    setSpinning(tap.tab);
    let seen = false;
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stopSpinning = () => {
      if (pending.current !== tap) return;
      pending.current = null;
      setSpinning(null);
    };
    const finish = () => {
      if (done) return;
      done = true;
      const left = Math.max(0, TAB_SPIN_MIN_MS - (Date.now() - tap.at));
      timers.push(
        setTimeout(() => {
          if (pending.current !== tap) return;
          // The selected tab can start its read while this timer is pending.
          if (readsInFlight() > 0) {
            seen = true;
            done = false;
            return;
          }
          stopSpinning();
        }, left),
      );
    };
    const check = () => {
      if (readsInFlight() > 0) seen = true;
      else if (seen) finish();
    };
    const stop = onReadsInFlight(check);
    check();
    timers.push(
      setTimeout(() => {
        if (!seen) finish();
      }, TAB_SPIN_WAIT_MS),
      setTimeout(stopSpinning, TAB_SPIN_MAX_MS),
    );
    return () => {
      stop();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [tap]);
  return {
    spinning,
    tapped: (tab, destination) => {
      if (pending.current?.tab === tab && pending.current.destination === destination) return false;
      const next = { tab, at: Date.now(), destination };
      pending.current = next;
      setTap(next);
      refreshTabReads(tab);
      return true;
    },
  };
}

export function AppNav() {
  // Reading a conversation happens on a screen that is not this one, so the
  // hook listens for `unreadChanged()` rather than this refetching on every
  // navigation. See src/lib/chat/unread.ts.
  const { count } = useUnreadThreads();
  // The bar is on every screen, so the app icon's number is kept here.
  useIconBadge();
  // Red on Home, where the bell is, so a notification is not missed on a
  // screen with no bell (the owner, 2026-11-01; the bell back on Home
  // 2026-11-06). Not for a conversation: Chat's own dot says that.
  const { count: unseen } = useUnseenNotifications(true);
  // And while their email waits to be confirmed (the owner, 2026-11-04).
  const unproven = useUnprovenEmail() !== null;
  const location = useLocation();
  const wide = useWideLayout();
  const lit = litTab(location.pathname, location.state);
  const { spinning, tapped } = useTabSpinner(location);
  // The bar stays still on every screen, Home's feed included, while people
  // get used to the app (the owner, 2026-11-15). It slid away on a scroll
  // from 2026-11-01, on Home's feed only from 2026-11-09.

  // The bar is on every screen, so somebody writing to you while you read an
  // event is heard here: each unmuted message writes this member a
  // notification row (notifications_record), so no club-wide message feed.
  useBadgeRealtime();

  // Bottom bar on a phone, top bar on a desktop.
  //
  // The five items still stay together rather than stretching: five tabs spread
  // across a 27-inch monitor read as a toolbar, and the targets end up nowhere
  // near each other. What changes is where the bar sits. A bottom tab bar is a
  // phone convention built around the thumb, and on a desktop it is the
  // furthest point from where somebody is reading, with no thumb to justify it.
  //
  // `order` rather than a second copy of the bar: the nav stays first in the
  // DOM, so it is first for a screen reader and first in the tab order at both
  // widths, and only its painted position moves.
  return (
    <nav
      aria-label="Main"
      className={cn(
        'z-40 order-last flex-none bg-paper px-2',
        'border-line border-t pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        'md:order-first md:border-t-0 md:border-b md:px-4 md:pt-1.5 md:pb-1.5',
      )}
    >
      <div
        className={cn(
          'mx-auto grid w-full max-w-[480px] grid-cols-5 gap-0.5',
          'md:mx-0 md:flex md:max-w-none md:justify-start md:gap-1',
        )}
      >
        {TABS.map(({ to, label, Icon }) => {
          const isActive = lit === to;
          // Every tab opens on its first screen (the owner, 2026-11-19: "When
          // I tap on home it should take me to home, not the last page I was
          // on"), Chat too ("it should take you to the chat tab, not the last
          // chat you were in"; from 2026-11-10 it went back to the
          // conversation it was left in). A message half written is still in
          // its conversation (lib/chat/drafts.ts).
          return (
            <Link
              key={to}
              to={to}
              // The way back is that tab's own (lib/back-trail.ts). And what
              // the tab shows is read again behind what it already has, every
              // tap (the owner, 2026-11-19: "load what is cached, but also
              // refresh it"), not only after a minute (lib/kept-reads.ts).
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (!tapped(to, to)) {
                  event.preventDefault();
                  return;
                }
                sayNext('tab');
              }}
              aria-busy={spinning === to ? true : undefined}
              aria-current={isActive ? 'page' : undefined}
              // The dot is decorative, so without this the tab is called "Chat"
              // and what it is telling somebody is told only in navy. The label
              // starts with the visible word, so what is said and what is shown
              // still agree.
              aria-label={
                to === '/chat' && count > 0
                  ? 'Chat, something new'
                  : to === '/home' && unseen > 0
                    ? 'Home, new notifications'
                    : to === '/me' && unproven
                      ? 'Me, confirm your email'
                      : undefined
              }
              className={cn(
                'relative flex flex-col items-center gap-0.5 rounded-xl pt-1 pb-0.5 font-bold text-[0.625rem]',
                // Icon over label on a phone and an iPad held upright, beside
                // it from a laptop's width, where the row is wide and the
                // stacked label is needlessly small. Beside it on an upright
                // iPad ran off at a larger text size (the owner, 2026-11-06).
                'md:px-2.5 lg:flex-row lg:gap-2 lg:px-3 lg:py-1.5 lg:text-[0.875rem]',
                isActive ? 'text-emphasis' : 'text-grey',
                !isActive && 'md:hover:bg-tint',
              )}
            >
              {/* Every item gets the same row height, so the five labels sit
                  on one line. */}
              <span className="relative grid h-7 w-7 place-items-center rounded-[10px]">
                <Icon className={cn('h-[20px] w-[20px]', isActive && '[stroke-width:2.3]')} />
                {spinning === to ? (
                  // A ring turning round the icon while the tab reads again.
                  // Still for somebody who asks for less motion: the ring
                  // with its one bright arc still says it is busy.
                  <span
                    aria-hidden="true"
                    data-testid="tab-spinner"
                    className="-inset-[3px] -translate-y-px pointer-events-none absolute rounded-full border-2 border-line border-t-emphasis border-r-emphasis motion-safe:animate-spin"
                  />
                ) : null}
                {to === '/home' && unseen > 0 ? (
                  <span
                    aria-hidden="true"
                    className="-top-0.5 -right-1 absolute grid h-[16px] w-[16px] place-items-center rounded-full bg-destructive-fill ring-2 ring-paper"
                  >
                    <Bell className="h-[10px] w-[10px] fill-white text-white" strokeWidth={2.4} />
                  </span>
                ) : null}
                {to === '/me' && unproven ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 h-[9px] w-[9px] rounded-full bg-destructive-fill ring-2 ring-paper"
                  />
                ) : null}
                {to === '/chat' && count > 0 ? (
                  // Ringed in the bar's own colour so it reads as a dot on
                  // the icon rather than as part of it.
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 h-[9px] w-[9px] rounded-full bg-destructive-fill ring-2 ring-paper"
                  />
                ) : null}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
        {/* Desktop only, at the far end: on a phone the bell is in Home's
            header, and a sixth tab would crowd the five. */}
        {/* Display lives on Me only (the owner, 2026-10-22: the bar looked
            too busy), so the bell takes the push to the right. */}
        {wide !== false ? (
          <NotificationBell
            variant="bar"
            className={cn(
              'hidden md:ml-auto md:flex',
              location.pathname === '/notifications' && 'text-emphasis',
            )}
          />
        ) : null}
      </div>
    </nav>
  );
}
