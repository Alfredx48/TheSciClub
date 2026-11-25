import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useRsvpSheet } from '@/components/rsvp-sheet';
import { useAccount } from '@/lib/account';
import {
  type ClubLink,
  type ClubTopic,
  useClubTopic,
  useEventIdOf,
  useOwnRsvp,
} from '@/lib/chat/club-links';
import { isEventOver } from '@/lib/event-over';
import { setRsvp, useEvents } from '@/lib/events';
import { useOrganizations } from '@/lib/organizations';
import { EventCard } from '@/routes/events/event-card';
import type { RsvpStatus } from '@/types/domain';

/**
 * The card under a link to the club's own event or topic (club-links.ts), in
 * place of the card its page would give, which only said "The Sci Club".
 *
 * An event is the card from Events and Home: when, where, who hosts, and
 * RSVP, answered right here (the owner, 2026-11-08). A topic is its room, its
 * title and the start of its first post. Neither draws anything while it is
 * read or if the reader may not see it: the link in the words still opens it.
 */
export function ClubLinkCard({ link }: { link: ClubLink }) {
  return link.kind === 'event' ? (
    <SharedEventLink linkRef={link.ref} />
  ) : (
    <SharedTopicCard topicId={link.topicId} href={link.href} />
  );
}

function SharedEventLink({ linkRef }: { linkRef: string }) {
  const eventId = useEventIdOf(linkRef);
  return eventId ? <SharedEventCard eventId={eventId} /> : null;
}

function SharedEventCard({ eventId }: { eventId: string }) {
  const navigate = useNavigate();
  const { userId } = useAccount();
  const memberId = userId ?? null;
  const read = useEvents({ id: eventId });
  const own = useOwnRsvp(eventId, memberId);
  const { byId } = useOrganizations();
  const { saved, sheet } = useRsvpSheet(memberId);
  const [failure, setFailure] = useState<string | null>(null);
  const event = read.events.find((found) => found.id === eventId) ?? read.events[0];
  if (!event || own.status === undefined) return null;
  const organization = event.organizationId ? (byId.get(event.organizationId) ?? null) : null;

  const answer = (next: RsvpStatus | null) => {
    if (!memberId) return;
    setFailure(null);
    void setRsvp(event.id, memberId, next).then((result) => {
      if (!result.ok) {
        setFailure(result.error ?? 'Could not save that.');
        return;
      }
      own.set(next);
      // The going count comes from the database.
      read.reload?.();
      saved(event, next, answer);
    });
  };

  return (
    <div className="mt-2 text-left text-ink">
      <EventCard
        event={event}
        status={own.status}
        organization={organization}
        past={isEventOver(event)}
        attached
        inMessage
        onOpen={() => {
          void navigate(`/events/${event.id}`);
        }}
        onOpenOrganization={(id) => {
          void navigate(`/events/organizations/${id}`);
        }}
        onOpenMember={(id) => {
          void navigate(`/peers/${id}`);
        }}
        onRsvp={answer}
      />
      {failure ? (
        <p role="alert" className="mt-1.5 text-[0.78125rem] text-danger">
          {failure}
        </p>
      ) : null}
      {/* The sheet places itself in the app's frame, as it does on Events.
          Drawn here, a card that is \`relative\` (Home's, above its stretched
          link) held it inside the card (2026-11-25). */}
      {sheet ? createPortal(sheet, appFrame()) : null}
    </div>
  );
}

/** Where a sheet is drawn: the app's frame, or the page while there is none. */
function appFrame(): Element {
  return document.querySelector('.app-shell') ?? document.body;
}

function SharedTopicCard({ topicId, href }: { topicId: string; href: string }) {
  const read = useClubTopic(topicId);
  return read.status === 'ready' ? <TopicCardView topic={read.topic} href={href} /> : null;
}

/** The topic card, drawn from what was read. */
export function TopicCardView({ topic, href }: { topic: ClubTopic; href: string }) {
  const replies = `${String(topic.replyCount)} ${topic.replyCount === 1 ? 'reply' : 'replies'}`;
  return (
    <Link
      to={href}
      className="mt-2 block max-w-[420px] rounded-[12px] border border-line bg-paper px-3 py-2.5 text-left no-underline transition-colors hover:bg-tint"
    >
      <span className="flex items-center gap-1.5 font-semibold text-[0.71875rem] text-grey uppercase tracking-[0.06em]">
        <MessageSquare aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="truncate">{topic.roomName ?? 'Discussion room'}</span>
      </span>
      <span className="mt-0.5 line-clamp-3 block font-bold font-head text-[0.875rem] text-ink leading-[1.35]">
        {topic.title}
      </span>
      {topic.opening ? (
        <span className="mt-1 line-clamp-2 block text-[0.8125rem] text-ink2 leading-[1.45]">
          {topic.opening}
        </span>
      ) : null}
      <span className="mt-1 block text-[0.75rem] text-grey">{replies}</span>
    </Link>
  );
}
