import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { HeaderBack } from '@/components/back-line';
import type { ChatRoom } from '@/lib/chat/types';
import { backToHome } from '@/routes/home/back';

/**
 * Where a room or topic sits: Home › Rooms › the room.
 *
 * The owner, 2026-10-09: a topic opened from Home offered only "Home", and
 * one opened in a room only that room. Every way out is now one tap: Home (the
 * pill it came from, when it came from Home), every room, and this room's
 * other topics. Replaces the single back link on the room and topic pages.
 *
 * A list in a nav named "Breadcrumb", the pattern a screen reader announces
 * as such; the chevrons between are decoration.
 */
export function ChatBreadcrumb({
  state,
  room,
}: {
  /** Router state, for the Home pill the member came from. */
  state: unknown;
  /** The room, on a topic. Left out on the room's own page. */
  room?: ChatRoom | null;
}) {
  const crumbs: [string, string][] = [
    [backToHome(state) ?? '/home', 'Home'],
    ['/chat?segment=rooms', 'Rooms'],
  ];
  if (room) crumbs.push([`/chat/rooms/${room.id}`, room.name]);

  return (
    <div className="flex items-center">
      {/* The way back along the trail, so no line of its own (the owner, 2026-11-21). */}
      <HeaderBack
        to={room ? `/chat/rooms/${room.id}` : '/chat?segment=rooms'}
        label={room ? room.name : 'Chat'}
        className="h-9 w-8"
      />
      <nav aria-label="Breadcrumb">
        <ol className="-ml-1 flex flex-wrap items-center gap-x-0.5">
          {crumbs.map(([to, label], index) => (
            <Fragment key={to}>
              {index > 0 ? (
                <li aria-hidden="true" className="text-grey">
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
              ) : null}
              <li className="min-w-0">
                <Link
                  to={to}
                  data-target="small"
                  className="inline-flex min-h-[36px] items-center rounded-[8px] px-1 py-1.5 font-semibold text-[0.875rem] text-emphasis underline-offset-2 hover:underline"
                >
                  {label}
                </Link>
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
    </div>
  );
}
