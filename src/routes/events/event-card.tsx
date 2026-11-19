import { ExternalLink } from 'lucide-react';
import { isNative } from '@/lib/standalone';
import { cn } from '@/lib/utils';
import { EventCover } from '@/routes/events/event-cover';
import { isOnline } from '@/routes/events/filters';
import { dateTileParts, rsvpReachesHost, shortWeekday, timeRange } from '@/routes/events/format';
import { GoingCount } from '@/routes/events/going-count';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { OutOfStateMark } from '@/routes/events/out-of-state';
import { placeLine } from '@/routes/events/place';
import { PrivacyChip } from '@/routes/events/privacy-chip';
import { safeHref } from '@/routes/events/rich-text';
import { ViewOnMap } from '@/routes/events/view-on-map';
import type { ClubEvent, Organization, RsvpStatus } from '@/types/domain';

/**
 * One event in the list, matching `.ecard` in docs/index.html.
 *
 * Presentational: it takes an event and three handlers, it never fetches, and
 * it holds no state. The optimistic count arithmetic lives in the page, which
 * owns the RSVP that causes it.
 *
 * ---------------------------------------------------------------------------
 * Interested and Going are on the card, not behind a dialog
 * ---------------------------------------------------------------------------
 * ab-peers opened a modal to collect an RSVP. The mock puts both as a button
 * row on the card itself and the owner took that, which is the right call: the
 * decision is one tap and a dialog turns it into three, on a surface somebody
 * is scanning quickly.
 *
 * ---------------------------------------------------------------------------
 * There is no "not interested" ✕
 * ---------------------------------------------------------------------------
 * ab-peers had one and this card carried it for a while. It was removed,
 * because nothing consumed the signal: there is no ranking that learns from a
 * dismissal, so hiding an event only ever shortened one list, and the way back
 * was a toggle buried in the filter sheet.
 *
 * It also solved the wrong problem. NorCal SCI's calendar is ~100 events made
 * of ~15 distinct ones repeating weekly, so the annoyance is "not this, ever",
 * and hiding a single occurrence of a Friday group does nothing about next
 * Friday. If that returns it should dismiss a series — and a small ✕ sitting
 * against the edge of a tappable card is a mis-tap waiting to happen for
 * anybody aiming with a head pointer.
 */

export interface EventCardProps {
  event: ClubEvent;
  /** The viewer's own RSVP, or null if they have not said. */
  status: RsvpStatus | null;
  /** The hosting club organization, when the event links to one. */
  organization: Organization | null;
  onOpen: () => void;
  /** A click on the host's logo or name, when there is an organization to open. */
  onOpenOrganization?: (id: string) => void;
  /** A click on somebody in the list that opens from the count. */
  onOpenMember?: (id: string) => void;
  onRsvp: (next: RsvpStatus | null) => void;
  /**
   * Drop the bottom margin, because something belongs directly under this card.
   * Used for the occurrences of an expanded series, which read as one block.
   */
  attached?: boolean;
  /**
   * Shared in a chat message (the owner, 2026-11-18: "there is no space for a
   * picture and a description. Drop the picture and just have the
   * description. Cap it"): no picture, and the words cut at MESSAGE_WORDS.
   */
  inMessage?: boolean;
  /**
   * Drawn inside the card's border, under the buttons.
   *
   * The series line lives here rather than under the card. Sat outside, its
   * own margin and the card's were within a pixel of each other, so the line
   * floated exactly between two cards and belonged, visibly, to neither. A
   * rule that says "this card repeats" has to be inside the card it is about.
   */
  footer?: React.ReactNode;
  /**
   * One more date of the series on the card above, rather than an event in its
   * own right.
   *
   * Drops the title, the host and the mark, because all three are identical to
   * the card this sits under — four rows of "The Lionheart Community's Weekl…"
   * spent the whole line on the one thing the reader already knew, and
   * truncated it. What is left is the only thing that differs between
   * occurrences, which is when.
   */
  occurrence?: boolean;
  /** The Events map opened on it; only for one the map can hold (show-on-map.ts). */
  mapHref?: string | undefined;
  /**
   * Draw this as a record of something that happened rather than as an offer.
   *
   * Set from the event's own date, not from which segment is showing, because
   * the answer does not change with the segment: there is nothing to decide
   * about an evening that is over, wherever you meet it.
   */
  past?: boolean;
}

const RSVP_BUTTON =
  'flex min-h-11 items-center justify-center rounded-full px-4 font-bold font-head text-[0.8125rem] transition-colors';
const RSVP_OPEN = 'border-[1.4px] border-line text-emphasis hover:border-emphasis hover:bg-tint';
const RSVP_CHOSEN = 'border-[1.4px] border-emphasis bg-tint text-emphasis hover:bg-line';

/** How many characters of an event's words a chat message carries. */
const MESSAGE_WORDS = 140;

/** At most `max` characters, cut at a word and marked with an ellipsis. */
export function capWords(text: string | null | undefined, max: number): string {
  const words = (text ?? '').replace(/\s+/g, ' ').trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : words.slice(0, max)).replace(/[\s,.;:–—-]+$/, '')}…`;
}

export function EventCard({
  event,
  status,
  organization,
  onOpen,
  onOpenOrganization,
  onOpenMember,
  onRsvp,
  past = false,
  attached = false,
  inMessage = false,
  footer,
  occurrence = false,
  mapHref,
}: EventCardProps) {
  // Inside the card's button, so it cannot be a link of its own. A pointer
  // that lands on the logo goes to the host (2026-10-20); a keyboard has the
  // host's link on the event's page.
  const hostBadge = (badge: React.ReactNode) =>
    organization && onOpenOrganization ? (
      // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the event page links the host
      // biome-ignore lint/a11y/useKeyWithClickEvents: the card's button keeps Enter and Space for the event
      <span
        className="cursor-pointer"
        onClick={(click) => {
          click.stopPropagation();
          onOpenOrganization(organization.id);
        }}
      >
        {badge}
      </span>
    ) : (
      badge
    );
  const tile = dateTileParts(event.startTime, event.timezone);
  const going = status === 'going';
  const interested = status === 'interested';

  // The host line: a club organization if it links to one, otherwise the name
  // the feed gave. The city used to sit here too, and the raw location on the
  // line below carried its own copy of it — so every card with an address
  // printed its city twice, a line apart. "Where" is one line now, and the
  // host has this one to itself.
  const metaLine = organization?.name ?? event.hostName;
  const whenLine = timeRange(event.startTime, event.endTime, event.timezone, event.allDay);
  const whereLine = placeLine(event);
  const registerHref = safeHref(event.registrationUrl);
  const separateRegistration = registerHref !== null && !isNative();
  // In a message, the card's sentence or else the start of the description,
  // cut short; elsewhere the sentence only, as before.
  const summary = inMessage
    ? capWords(event.detailSummary?.trim() ? event.detailSummary : event.description, MESSAGE_WORDS)
    : event.detailSummary;

  // A past event is a line, not a card. Everything the full card carries is
  // there to answer "should I go to this" — the tags, the place, who else is
  // going, and the two buttons — and none of that is a live question once the
  // evening is over. What is left is what a member is actually reading for:
  // when it was, what it was, and whose it was.
  //
  // It stays a button to the detail page. That page still has the description
  // and the link, which is where somebody goes to remember what a thing was.
  if (occurrence) {
    return (
      <div
        className={cn(
          'w-full rounded-[11px] border border-line bg-paper px-3 py-2',
          attached ? 'mb-1' : 'mb-1.5',
        )}
      >
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left">
          <span className="block w-[3.25rem] flex-none rounded-[9px] bg-tint px-0 py-1 text-center">
            <span className="block font-extrabold font-head text-[0.875rem] text-emphasis leading-[1.1]">
              {tile.day}
            </span>
            <span className="block font-extrabold text-[0.5625rem] text-ink2 tracking-[0.08em]">
              {tile.mon}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink2 leading-[1.35]">
            {shortWeekday(event.startTime, event.timezone)}
            {whenLine ? ` · ${whenLine}` : ''}
          </span>
        </button>
      </div>
    );
  }

  if (past) {
    return (
      <div
        className={cn(
          'w-full rounded-[13px] border border-line bg-paper px-3 py-2.5',
          attached ? 'mb-0' : 'mb-1.5',
        )}
      >
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left">
          <span className="block w-[3.25rem] flex-none rounded-[10px] bg-tint px-0 py-1 text-center">
            <span className="block font-extrabold font-head text-[0.9375rem] text-emphasis leading-[1.1]">
              {tile.day}
            </span>
            <span className="block font-extrabold text-[0.625rem] text-ink2 tracking-[0.08em]">
              {tile.mon}
            </span>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-extrabold font-head text-[0.9375rem] text-ink2 leading-[1.3]">
              {event.title}
            </span>
            {/* Host and time on one line. Two lines of grey under a greyed
                title is most of the height back. */}
            <span className="mt-[2px] block truncate text-[0.75rem] text-grey leading-[1.35]">
              {[metaLine, whenLine].filter(Boolean).join(' · ')}
            </span>
          </span>

          {hostBadge(
            <OrganizationBadge
              organization={organization}
              hostName={event.hostName}
              className="h-[2.89em] w-[2.89em] rounded-[1em] text-[0.5625rem]"
            />,
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative w-full rounded-[17px] border border-line bg-paper p-3.5',
        attached ? 'mb-0' : 'mb-[11px]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn('flex w-full items-start gap-[13px] text-left', inMessage && 'flex-wrap')}
      >
        {/* Date and host stacked in one narrow column, so the title always
            starts at the same x no matter which of them is present. */}
        <span className="flex flex-none flex-col items-center gap-2">
          {/* Width in rem so the tile grows with the text inside it. Left in
              pixels, "SEP" wraps as soon as somebody raises the text size. */}
          <span className="block w-[3.625rem] rounded-[14px] bg-tint px-0 pt-2 pb-[9px] text-center">
            <span className="block font-extrabold text-[0.65625rem] text-ink2 tracking-[0.09em]">
              {tile.dow}
            </span>
            <span className="block font-extrabold font-display text-[1.4375rem] text-emphasis leading-[1.15]">
              {tile.day}
            </span>
            <span className="block font-extrabold text-[0.65625rem] text-ink2 tracking-[0.09em]">
              {tile.mon}
            </span>
          </span>
          {hostBadge(<OrganizationBadge organization={organization} hostName={event.hostName} />)}
        </span>

        {/* A long address or link wraps inside the card, as a message does. */}
        <span className="min-w-0 flex-1 pr-5 [overflow-wrap:anywhere]">
          <span className="block font-extrabold font-head text-[1.03125rem] text-ink leading-[1.28] tracking-[-0.01em]">
            {event.title}
          </span>

          <span className="mt-[7px] flex flex-wrap gap-1.5">
            {/* Format first and in gold, matching the mock: "can I get to this"
                is the question that decides whether the rest of the card is
                worth reading. */}
            <PrivacyChip audience={event.audience} />
            {isOnline(event) ? (
              <span className="rounded-full bg-gold-lt px-2.5 py-[5px] font-semibold text-[0.7375rem] text-gold-dp leading-[1.25]">
                {event.format === 'hybrid' ? 'Hybrid' : 'Online'}
              </span>
            ) : null}
            {event.tags.map((tag) => (
              <span
                key={tag.slug}
                className="rounded-full bg-tint px-2.5 py-[5px] font-semibold text-[0.7375rem] text-emphasis leading-[1.25]"
              >
                {tag.name}
              </span>
            ))}
          </span>

          {metaLine ? (
            <span className="mt-[3px] block text-[0.8125rem] text-ink2 leading-[1.42]">
              {hostBadge(<span className="underline-offset-2 hover:underline">{metaLine}</span>)}
            </span>
          ) : null}
          {whenLine ? (
            <span className="mt-0.5 block text-[0.78125rem] text-grey leading-[1.42]">
              {whenLine}
            </span>
          ) : null}
          {whereLine ? (
            <span className="mt-0.5 block text-[0.78125rem] text-grey leading-[1.42]">
              {whereLine}
            </span>
          ) : null}
          <OutOfStateMark state={event.state} className="mt-1" />

          {summary && !inMessage ? (
            <span className="mt-1.5 block text-[0.8125rem] text-ink leading-[1.45]">{summary}</span>
          ) : null}
        </span>
        {inMessage ? null : (
          <EventCover path={event.photoPath} alt={event.photoAlt} size="card" className="-mr-1" />
        )}
        {/* In a message, the whole card's width under the date and title: in
            the column beside the date it ran five short lines (screenshot
            review, 2026-11-18). */}
        {summary && inMessage ? (
          <span className="-mt-1 block basis-full text-[0.8125rem] text-ink leading-[1.45]">
            {summary}
          </span>
        ) : null}
      </button>

      {/* Beside the card's button, not in it: it is a button of its own. */}
      <GoingCount
        eventId={event.id}
        going={event.goingCount}
        interested={event.interestedCount}
        onOpenMember={onOpenMember}
      />

      {/* Only as wide as their words, and quiet until chosen (the owner,
          2026-10-27): the card is for reading what the event is. Still a
          full 44px tall, for hands that need the room. What Going shares is
          said once it is pressed (rsvp-sheet.tsx). */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          // Pressing the button you are already on takes the RSVP back, which
          // is the only way to undo one from the list.
          onClick={() => {
            onRsvp(interested ? null : 'interested');
          }}
          aria-pressed={interested}
          className={cn(RSVP_BUTTON, interested ? RSVP_CHOSEN : RSVP_OPEN)}
        >
          {interested ? 'Interested ✓' : 'Interested'}
        </button>
        {/* As on the event's page (the owner, 2026-10-27): with a sign-up of
            the host's own, Register stands for Going, marks them going and
            opens it. Once going, Going ✓ takes it back. */}
        {registerHref && !going && !separateRegistration ? (
          <a
            href={registerHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              onRsvp('going');
            }}
            className={cn(RSVP_BUTTON, RSVP_OPEN, 'gap-1.5')}
          >
            Register
            <span className="sr-only">, opens the host’s sign-up and marks you as going</span>
            <ExternalLink className="h-[14px] w-[14px] flex-none" aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => {
              onRsvp(going ? null : 'going');
            }}
            aria-pressed={going}
            className={cn(RSVP_BUTTON, going ? RSVP_CHOSEN : RSVP_OPEN)}
          >
            {separateRegistration
              ? going
                ? 'Going in club ✓'
                : 'Going in club'
              : going
                ? 'Going ✓'
                : rsvpReachesHost(event, organization)
                  ? 'RSVP'
                  : 'Going'}
          </button>
        )}
        {separateRegistration ? (
          <a
            href={registerHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(RSVP_BUTTON, RSVP_OPEN, 'gap-1.5')}
          >
            Register with host
            <ExternalLink className="h-[14px] w-[14px] flex-none" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {/* Beside the card's own button, never inside it. */}
      {mapHref ? <ViewOnMap title={event.title} to={mapHref} className="mt-2.5" /> : null}

      {footer ? <div className="mt-2.5 border-line border-t pt-1">{footer}</div> : null}
    </div>
  );
}
