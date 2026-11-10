import { Bell } from 'lucide-react';
import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { touchScreen, useHideOnScroll } from '@/components/hide-on-scroll';
import { ChatIcon, EventsIcon, HomeIcon, MeIcon, PeersIcon } from '@/components/nav-icons';
import { NotificationBell, useWideLayout } from '@/components/notification-bell';
import { useBadgeRealtime } from '@/lib/badges';
import { useUnreadThreads } from '@/lib/chat/unread';
import { useUnprovenEmail } from '@/lib/email-proof';
import { useIconBadge } from '@/lib/icon-badge';
import { useUnseenNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { backToHome } from '@/routes/home/back';

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

/**
 * The tab a screen belongs to. A topic, an event or a profile opened from a
 * card on Home belongs to Home — its back link says Home and goes there — so
 * Home is lit rather than Chat, Events or Peers, whose paths those screens
 * live under. Otherwise a tab is lit on its own path and everything beneath
 * it, as NavLink would.
 */
export function litTab(pathname: string, state: unknown): string | null {
  if (backToHome(state) !== null) return '/home';
  const tab = TABS.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  return tab?.to ?? null;
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
  // On a phone only: a desktop's bar is at the top, out of the way already, and
  // a narrow desktop window keeps its bottom bar still. And on Home's feed only:
  // elsewhere it gained little and going in odd places confused (the owner,
  // 2026-11-09).
  const bar = useRef<HTMLElement | null>(null);
  const { hidden, show } = useHideOnScroll(
    wide === false && touchScreen() && location.pathname === '/home',
    location.pathname,
    bar,
  );

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
      ref={bar}
      aria-label="Main"
      // Reached by keyboard or switch control, it comes back to be used.
      onFocus={show}
      // A margin, not a transform, so the page below takes the room.
      style={hidden ? { marginBottom: -(bar.current?.offsetHeight ?? 0) } : undefined}
      className={cn(
        'z-40 order-last flex-none bg-paper px-2 transition-[margin-bottom] duration-300 ease-out',
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
          return (
            <Link
              key={to}
              to={to}
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
